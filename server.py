"""Serve the portal frontend, catalog API, and local PDF uploads."""

from __future__ import annotations

import argparse
import errno
import hmac
import json
import os
import secrets
import shutil
import threading
import time
from email.parser import BytesParser
from email.policy import default as email_policy
from functools import partial
from http.cookies import CookieError, SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import quote, parse_qs, urlsplit

from teachers import DuplicateTeacherError, TeacherAccountStore

from repository import (
    MAX_FOLDER_NAME_LENGTH,
    MAX_SUBJECT_CODE_LENGTH,
    MAX_SUBJECT_DESCRIPTION_LENGTH,
    MAX_SUBJECT_ICON_LENGTH,
    MAX_SUBJECT_NAME_LENGTH,
    MAX_UPLOAD_BYTES,
    PortalRepository,
)

PROJECT_ROOT = Path(__file__).resolve().parent
STATIC_ROOT = PROJECT_ROOT / "public"
DEFAULT_DATA_FILE = PROJECT_ROOT / "data" / "demo.json"
DATA_FILE = Path(os.environ.get(
    "CS_PORTAL_DATA_FILE", str(DEFAULT_DATA_FILE)
))
TEACHER_ACCOUNTS_FILE = Path(os.environ.get(
    "CS_PORTAL_TEACHER_ACCOUNTS_FILE",
    str(PROJECT_ROOT / "data" / "teachers.json"),
))
UPLOAD_ROOT = Path(os.environ.get(
    "CS_PORTAL_UPLOAD_ROOT",
    str(PROJECT_ROOT / "storage" / "documents"),
))
MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + 256 * 1024
MAX_JSON_REQUEST_BYTES = 16 * 1024
REQUIRE_CONFIGURED_CREDENTIALS = (
    os.environ.get("CS_PORTAL_REQUIRE_CONFIGURED_CREDENTIALS", "")
    .strip()
    .lower() == "true"
)
configured_teacher_username = os.environ.get(
    "CS_PORTAL_TEACHER_USERNAME"
)
configured_teacher_password = os.environ.get(
    "CS_PORTAL_TEACHER_PASSWORD"
)
if REQUIRE_CONFIGURED_CREDENTIALS and not (
    configured_teacher_username and configured_teacher_password
):
    raise RuntimeError(
        "Set CS_PORTAL_TEACHER_USERNAME and "
        "CS_PORTAL_TEACHER_PASSWORD before starting the hosted service."
    )
TEACHER_USERNAME = configured_teacher_username or "teacher123"
TEACHER_PASSWORD = configured_teacher_password or "admin@321"
COOKIE_SECURE = (
    os.environ.get("CS_PORTAL_COOKIE_SECURE", "").strip().lower()
    == "true"
)
ALLOWED_PUBLIC_ORIGINS = tuple(
    origin.strip().rstrip("/")
    for origin in os.environ.get("CS_PORTAL_ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
)
SESSION_COOKIE_NAME = "cs_core_teacher_session"
SESSION_DURATION_SECONDS = 8 * 60 * 60
COOKIE_SAMESITE = (
    "Secure; SameSite=Strict" if COOKIE_SECURE else "SameSite=Strict"
)
_SESSIONS: dict[str, float] = {}
_SESSION_LOCK = threading.Lock()


class UploadTooLargeError(ValueError):
    """Raised when an incoming upload exceeds configured limits."""


class PortalRequestHandler(SimpleHTTPRequestHandler):
    """Serve the web app and its local catalog and upload endpoints."""

    def __init__(
        self,
        *args: Any,
        repository: PortalRepository,
        teacher_accounts: TeacherAccountStore,
        **kwargs: Any,
    ) -> None:
        self.repository = repository
        self.teacher_accounts = teacher_accounts
        super().__init__(*args, directory=str(STATIC_ROOT), **kwargs)

    def do_GET(self) -> None:
        request = urlsplit(self.path)
        if request.path == "/api/session":
            self._send_json(
                200,
                {"authenticated": self._is_authenticated()},
            )
            return
        if request.path.startswith("/api/"):
            self._handle_api(request.path, parse_qs(request.query))
            return

        admin_pages = {"/admin", "/admin/", "/admin/index.html"}
        login_pages = {"/login", "/login/", "/login/index.html"}
        if request.path in admin_pages and not self._is_authenticated():
            self._redirect("/login/")
            return
        if request.path in login_pages and self._is_authenticated():
            self._redirect("/admin/")
            return
        super().do_GET()

    def do_POST(self) -> None:
        request = urlsplit(self.path)
        if request.path == "/api/session":
            if not self._allow_local_mutation():
                return
            self._handle_login()
            return

        if request.path == "/api/teachers":
            if not self._allow_local_mutation():
                return
            self._handle_teacher_registration()
            return

        if request.path not in {
            "/api/materials",
            "/api/upload",
            "/api/folders",
            "/api/subjects",
        }:
            self._send_json(404, {"error": "Unknown API endpoint"})
            return
        if not self._require_authenticated():
            return
        if not self._allow_local_mutation():
            return
        if request.path == "/api/subjects":
            self._handle_create_subject()
        elif request.path == "/api/folders":
            self._handle_create_folder()
        elif request.path == "/api/upload":
            self._handle_upload(file_field_name="pdf")
        else:
            self._handle_upload()

    def do_PUT(self) -> None:
        request = urlsplit(self.path)
        parts = request.path.strip("/").split("/")
        if len(parts) == 3 and parts[:2] == ["api", "materials"]:
            if not self._require_authenticated():
                return
            if not self._allow_local_mutation():
                return
            self._handle_update_material(parts[2])
            return
        if (
            len(parts) == 4
            and parts[:2] == ["api", "materials"]
            and parts[3] == "replace-pdf"
        ):
            if not self._require_authenticated():
                return
            if not self._allow_local_mutation():
                return
            self._handle_replace_pdf(parts[2])
            return
        self._send_json(404, {"error": "Unknown API endpoint"})

    def do_DELETE(self) -> None:
        request = urlsplit(self.path)
        parts = request.path.strip("/").split("/")
        if request.path == "/api/session":
            if not self._allow_local_mutation():
                return
            self._handle_logout()
            return
        if request.path == "/api/folders":
            if not self._require_authenticated():
                return
            if not self._allow_local_mutation():
                return
            self._handle_delete_folder()
            return
        if len(parts) == 3 and parts[:2] == ["api", "materials"]:
            if not self._require_authenticated():
                return
            if not self._allow_local_mutation():
                return
            self._handle_delete_material(parts[2])
            return
        self._send_json(404, {"error": "Unknown API endpoint"})

    def _redirect(self, location: str) -> None:
        self.send_response(303)
        self.send_header("Location", location)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def _session_token(self) -> str | None:
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
        except CookieError:
            return None
        morsel = cookie.get(SESSION_COOKIE_NAME)
        return morsel.value if morsel else None

    def _is_authenticated(self) -> bool:
        token = self._session_token()
        if not token:
            return False
        now = time.time()
        with _SESSION_LOCK:
            expires_at = _SESSIONS.get(token)
            if expires_at is None:
                return False
            if expires_at <= now:
                _SESSIONS.pop(token, None)
                return False
        return True

    def _require_authenticated(self) -> bool:
        if self._is_authenticated():
            return True
        self._send_json(
            401,
            {"error": "Teacher sign-in is required to manage content."},
        )
        return False

    def _handle_login(self) -> None:
        try:
            payload = self._read_json_body()
        except ValueError as error:
            self._send_json(400, {"error": str(error)})
            return

        username = payload.get("username")
        password = payload.get("password")
        if not isinstance(username, str) or not isinstance(password, str):
            self._send_json(
                400,
                {"error": "Enter a username and password."},
            )
            return

        username_matches = hmac.compare_digest(
            username.encode("utf-8"),
            TEACHER_USERNAME.encode("utf-8"),
        )
        password_matches = hmac.compare_digest(
            password.encode("utf-8"),
            TEACHER_PASSWORD.encode("utf-8"),
        )
        if not (
            username_matches and password_matches
        ) and not self.teacher_accounts.verify(username, password):
            self._send_json(401, {"error": "Username or password is incorrect."})
            return

        token = self._start_session()
        self._send_json(
            200,
            {"authenticated": True},
            headers={
                "Set-Cookie": (
                    f"{SESSION_COOKIE_NAME}={token}; Path=/; HttpOnly; "
                    f"{COOKIE_SAMESITE}; Max-Age={SESSION_DURATION_SECONDS}"
                )
            },
        )

    def _handle_teacher_registration(self) -> None:
        try:
            payload = self._read_json_body()
            name = payload.get("name")
            username = payload.get("username")
            password = payload.get("password")
            confirm_password = payload.get("confirmPassword")
            if not all(isinstance(value, str) for value in (
                name, username, password, confirm_password
            )):
                raise ValueError("Complete every teacher account field.")
            account = self.teacher_accounts.register(
                name=name,
                username=username,
                password=password,
                confirm_password=confirm_password,
            )
        except DuplicateTeacherError as error:
            self._send_json(409, {"error": str(error)})
            return
        except ValueError as error:
            self._send_json(400, {"error": str(error)})
            return
        except OSError as error:
            self.log_error("Could not save teacher account: %s", error)
            self._send_json(
                500,
                {"error": "The teacher account could not be saved."},
            )
            return

        token = self._start_session()
        self._send_json(
            201,
            {
                "authenticated": True,
                "teacher": {
                    "id": account.id,
                    "name": account.name,
                    "username": account.username,
                },
            },
            headers={
                "Set-Cookie": (
                    f"{SESSION_COOKIE_NAME}={token}; Path=/; HttpOnly; "
                    f"{COOKIE_SAMESITE}; Max-Age={SESSION_DURATION_SECONDS}"
                )
            },
        )

    @staticmethod
    def _start_session() -> str:
        token = secrets.token_urlsafe(32)
        with _SESSION_LOCK:
            _SESSIONS[token] = time.time() + SESSION_DURATION_SECONDS
        return token

    def _handle_logout(self) -> None:
        token = self._session_token()
        if token:
            with _SESSION_LOCK:
                _SESSIONS.pop(token, None)
        self._send_json(
            200,
            {"authenticated": False},
            headers={
                "Set-Cookie": (
                    f"{SESSION_COOKIE_NAME}=; Path=/; HttpOnly; "
                    f"{COOKIE_SAMESITE}; Max-Age=0"
                )
            },
        )

    def _allow_local_mutation(self) -> bool:
        origin = self.headers.get("Origin")
        if origin and not self._is_same_origin(origin):
            self._send_json(
                403,
                {"error": "Cross-origin changes are not allowed."},
            )
            return False
        return True

    def _is_same_origin(self, origin: str) -> bool:
        origin_url = urlsplit(origin)
        normalized_origin = origin.rstrip("/")
        if normalized_origin in ALLOWED_PUBLIC_ORIGINS:
            return origin_url.scheme == "https"
        request_host = urlsplit(
            "//" + self.headers.get("Host", "")
        ).hostname
        allowed_hosts = {"127.0.0.1", "localhost", "::1"}
        return (
            origin_url.scheme == "http"
            and origin_url.hostname in allowed_hosts
            and origin_url.hostname == request_host
        )

    def _handle_api(
        self, path: str, query: dict[str, list[str]]
    ) -> None:
        catalog = self.repository.catalog
        if path == "/api/health":
            self._send_json(
                200,
                {
                    "status": "ok",
                    "mode": "local",
                    "subjects": len(catalog.subjects),
                    "materials": len(catalog.materials),
                    "maxUploadBytes": MAX_UPLOAD_BYTES,
                    "maxFolderNameLength": MAX_FOLDER_NAME_LENGTH,
                    "maxSubjectNameLength": MAX_SUBJECT_NAME_LENGTH,
                    "maxSubjectCodeLength": MAX_SUBJECT_CODE_LENGTH,
                    "maxSubjectDescriptionLength": (
                        MAX_SUBJECT_DESCRIPTION_LENGTH
                    ),
                    "maxSubjectIconLength": MAX_SUBJECT_ICON_LENGTH,
                },
            )
            return

        if path == "/api/catalog":
            self._send_json(200, catalog.public_payload())
            return

        if path == "/api/hierarchy":
            self._send_json(200, catalog.hierarchy_payload())
            return

        if path == "/api/materials":
            subject_name = query.get("subject", [None])[0]
            try:
                materials = catalog.materials_payload(subject_name)
            except KeyError:
                self._send_json(
                    404,
                    {"error": f"Unknown subject: {subject_name}"},
                )
                return
            self._send_json(200, materials)
            return

        if path.startswith("/api/files/"):
            self._serve_uploaded_file(path.removeprefix("/api/files/"))
            return

        self._send_json(404, {"error": "Unknown API endpoint"})

    def _handle_create_subject(self) -> None:
        try:
            payload = self._read_json_body()
            name = payload.get("name")
            code = payload.get("code")
            description = payload.get("description", "")
            icon = payload.get("icon")
            first_folder = payload.get("firstFolder", "")
            if not all(isinstance(value, str) for value in (
                name, code, description, icon, first_folder
            )):
                raise ValueError(
                    "Subject name, code, description, icon, and first folder "
                    "must be text."
                )
            subject = self.repository.add_subject(
                name=name,
                code=code,
                description=description,
                icon=icon,
                first_folder=first_folder,
            )
        except ValueError as error:
            self._send_json(400, {"error": str(error)})
            return
        except OSError as error:
            self.log_error("Could not persist new subject: %s", error)
            self._send_json(
                500,
                {"error": "The server could not save this subject."},
            )
            return

        self._send_json(201, {"subject": subject.to_json()})

    def _handle_create_folder(self) -> None:
        try:
            payload = self._read_json_body()
            subject = payload.get("subject")
            folder_name = payload.get("folder", payload.get("name"))
            if not isinstance(subject, str) or not isinstance(
                folder_name, str
            ):
                raise ValueError("Choose a subject and enter a folder name.")
            saved_name = self.repository.add_folder(subject, folder_name)
        except ValueError as error:
            self._send_json(400, {"error": str(error)})
            return
        except OSError as error:
            self.log_error("Could not persist new folder: %s", error)
            self._send_json(
                500,
                {"error": "The server could not save this folder."},
            )
            return

        self._send_json(
            201,
            {"subject": subject, "folder": saved_name},
        )

    def _handle_delete_folder(self) -> None:
        try:
            payload = self._read_json_body()
            subject = payload.get("subject")
            folder_name = payload.get("folder")
            if not isinstance(subject, str) or not isinstance(
                folder_name, str
            ):
                raise ValueError("Choose a subject and folder to delete.")
            deleted_documents = self.repository.delete_folder(
                subject,
                folder_name,
            )
        except ValueError as error:
            self._send_json(400, {"error": str(error)})
            return
        except OSError as error:
            self.log_error("Could not delete folder: %s", error)
            self._send_json(500, {"error": "The folder could not be deleted."})
            return

        self._send_json(
            200,
            {
                "subject": subject,
                "folder": folder_name,
                "deletedDocuments": deleted_documents,
                "message": (
                    f"Deleted {folder_name} and "
                    f"{deleted_documents} document(s)."
                ),
            },
        )

    def _handle_update_material(self, material_id: str) -> None:
        try:
            payload = self._read_json_body()
            title = payload.get("title")
            folder = payload.get("folder")
            description = payload.get("description", "")
            if not all(isinstance(value, str) for value in (
                title, folder, description
            )):
                raise ValueError(
                    "Title, folder, and description must be text."
                )
            material = self.repository.update_material(
                material_id,
                title=title,
                folder=folder,
                description=description,
            )
        except ValueError as error:
            self._send_json(400, {"error": str(error)})
            return
        except OSError as error:
            self.log_error("Could not update document: %s", error)
            self._send_json(
                500,
                {"error": "The document details could not be saved."},
            )
            return

        self._send_json(200, {"material": material.to_json()})

    def _handle_delete_material(self, material_id: str) -> None:
        try:
            material = self.repository.delete_material(material_id)
        except ValueError as error:
            self._send_json(404, {"error": str(error)})
            return
        except OSError as error:
            self.log_error("Could not delete document: %s", error)
            self._send_json(
                500,
                {"error": "The document could not be deleted."},
            )
            return

        self._send_json(200, {"material": material.to_json()})

    def _handle_replace_pdf(self, material_id: str) -> None:
        try:
            _, file_name, content = self._read_upload_form(
                required_fields=(),
                file_field_name="pdf",
            )
            material = self.repository.replace_pdf(
                material_id,
                file_name=file_name,
                content=content,
            )
        except UploadTooLargeError as error:
            self._send_json(413, {"error": str(error)})
            return
        except ValueError as error:
            self._send_json(400, {"error": str(error)})
            return
        except OSError as error:
            self.log_error("Could not replace uploaded PDF: %s", error)
            self._send_json(500, {"error": "The PDF could not be replaced."})
            return

        self._send_json(200, {"material": material.to_json()})

    def _read_json_body(self) -> dict[str, object]:
        content_type = self.headers.get("Content-Type", "")
        if not content_type.lower().startswith("application/json"):
            raise ValueError("Send request details as JSON.")
        try:
            content_length = int(self.headers.get("Content-Length", ""))
        except ValueError as error:
            raise ValueError(
                "The JSON request has no valid content length."
            ) from error
        if content_length <= 0 or content_length > MAX_JSON_REQUEST_BYTES:
            raise ValueError(
                "The JSON request must be under "
                f"{MAX_JSON_REQUEST_BYTES // 1024} KiB."
            )

        body = self.rfile.read(content_length)
        if len(body) != content_length:
            raise ValueError("The JSON request was incomplete.")
        try:
            payload = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ValueError(
                "The JSON request contains invalid JSON."
            ) from error
        if not isinstance(payload, dict):
            raise ValueError("The JSON request must be an object.")
        return payload

    def _handle_upload(self, *, file_field_name: str = "file") -> None:
        try:
            fields, file_name, content = self._read_upload_form(
                file_field_name=file_field_name,
            )
            material = self.repository.add_pdf(
                title=fields["title"],
                subject=fields["subject"],
                folder=fields["folder"],
                description=fields.get("description", ""),
                file_name=file_name,
                content=content,
            )
        except UploadTooLargeError as error:
            self._send_json(413, {"error": str(error)})
            return
        except (KeyError, ValueError) as error:
            self._send_json(400, {"error": str(error)})
            return
        except OSError as error:
            self.log_error("Could not persist uploaded PDF: %s", error)
            self._send_json(
                500,
                {"error": "The server could not save this document."},
            )
            return

        self._send_json(201, {"material": material.to_json()})

    def _read_upload_form(
        self,
        *,
        required_fields: tuple[str, ...] = ("title", "subject", "folder"),
        file_field_name: str = "file",
    ) -> tuple[dict[str, str], str, bytes]:
        content_type = self.headers.get("Content-Type", "")
        if not content_type.lower().startswith("multipart/form-data;"):
            raise ValueError("Send the document as a multipart PDF upload.")

        try:
            content_length = int(self.headers.get("Content-Length", ""))
        except ValueError as error:
            raise ValueError(
                "The upload request has no valid content length."
            ) from error

        if content_length <= 0:
            raise ValueError("Choose a PDF to upload.")
        if content_length > MAX_REQUEST_BYTES:
            raise UploadTooLargeError(
                "The upload request is larger than the allowed PDF size."
            )

        body = self.rfile.read(content_length)
        if len(body) != content_length:
            raise ValueError(
                "The upload request ended before the file was complete."
            )

        message = BytesParser(policy=email_policy).parsebytes(
            (
                f"Content-Type: {content_type}\r\n"
                "MIME-Version: 1.0\r\n\r\n"
            ).encode("ascii")
            + body
        )
        if not message.is_multipart():
            raise ValueError("The upload form is malformed.")

        fields: dict[str, str] = {}
        file_name: str | None = None
        file_content: bytes | None = None
        for part in message.iter_parts():
            name = part.get_param("name", header="content-disposition")
            if not isinstance(name, str):
                continue
            payload = part.get_payload(decode=True) or b""
            if name == file_field_name:
                if file_content is not None:
                    raise ValueError("Upload one PDF at a time.")
                file_name = part.get_filename()
                file_content = payload
                continue
            if name not in {"title", "subject", "folder", "description"}:
                continue
            if name in fields:
                raise ValueError(f"Duplicate upload field: {name}")
            try:
                fields[name] = payload.decode("utf-8")
            except UnicodeDecodeError as error:
                raise ValueError(
                    f"The {name} field must use UTF-8 text."
                ) from error

        if file_name is None or file_content is None:
            raise ValueError("Choose a PDF file to upload.")
        if len(file_content) > MAX_UPLOAD_BYTES:
            limit_mib = MAX_UPLOAD_BYTES // (1024 * 1024)
            raise UploadTooLargeError(
                f"The PDF exceeds the {limit_mib} MiB upload limit."
            )
        for required in required_fields:
            if not fields.get(required, "").strip():
                raise ValueError(f"Complete the {required} field.")

        return fields, file_name, file_content

    def _serve_uploaded_file(self, material_id: str) -> None:
        stored = self.repository.uploaded_file(material_id)
        if stored is None:
            self._send_json(404, {"error": "Document not found"})
            return

        material, file_path = stored
        try:
            file_obj = file_path.open("rb")
        except OSError as error:
            self.log_error("Could not open uploaded PDF: %s", error)
            self._send_json(404, {"error": "Document not found"})
            return

        encoded_name = quote(material.file_name, safe="")
        with file_obj:
            self.send_response(200)
            self.send_header("Content-Type", "application/pdf")
            self.send_header("Content-Length", str(file_path.stat().st_size))
            self.send_header(
                "Content-Disposition",
                f"inline; filename*=UTF-8''{encoded_name}",
            )
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            while chunk := file_obj.read(64 * 1024):
                self.wfile.write(chunk)

    def _send_json(
        self,
        status: int,
        payload: object,
        *,
        headers: dict[str, str] | None = None,
    ) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the CS Core Portal local demo."
    )
    parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="Interface to bind (default: localhost only).",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("PORT", "13000")),
        help=(
            "First port to try; if it is occupied, the server checks the "
            "next 100 ports (default: 13000)."
        ),
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not DATA_FILE.exists() and DATA_FILE != DEFAULT_DATA_FILE:
        DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(DEFAULT_DATA_FILE, DATA_FILE)
    repository = PortalRepository(DATA_FILE, UPLOAD_ROOT)
    teacher_accounts = TeacherAccountStore(
        TEACHER_ACCOUNTS_FILE,
        reserved_usernames=(TEACHER_USERNAME,),
    )
    handler = partial(
        PortalRequestHandler,
        repository=repository,
        teacher_accounts=teacher_accounts,
    )
    server = None
    for port in range(args.port, args.port + 101):
        try:
            server = ThreadingHTTPServer((args.host, port), handler)
            break
        except OSError as error:
            if error.errno != errno.EADDRINUSE:
                raise
    if server is None:
        raise OSError(
            f"No available port from {args.port} to {args.port + 100}."
        )

    actual_port = server.server_address[1]
    print(f"CS Core Portal: http://{args.host}:{actual_port}")
    print("Uploads are stored locally. Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping CS Core Portal.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

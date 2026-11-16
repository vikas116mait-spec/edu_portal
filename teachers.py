"""Persistent teacher accounts for the local study portal."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import tempfile
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

PASSWORD_HASH_ITERATIONS = 310_000
PASSWORD_MIN_LENGTH = 10
PASSWORD_MAX_LENGTH = 256
USERNAME_PATTERN = re.compile(r"[a-z0-9][a-z0-9._-]{2,31}\Z")


class DuplicateTeacherError(ValueError):
    """Raised when a username is already taken or reserved."""


@dataclass(frozen=True)
class TeacherAccount:
    """A registered teacher and their password verifier."""

    id: str
    name: str
    username: str
    salt: str
    password_hash: str
    iterations: int
    created_at: str

    def to_record(self) -> dict[str, str | int]:
        """Return the JSON representation stored on disk."""
        return {
            "id": self.id,
            "name": self.name,
            "username": self.username,
            "salt": self.salt,
            "passwordHash": self.password_hash,
            "iterations": self.iterations,
            "createdAt": self.created_at,
        }


class TeacherAccountStore:
    """Create, persist, and verify teacher accounts."""

    def __init__(
        self,
        file_path: Path,
        *,
        reserved_usernames: tuple[str, ...] = (),
    ) -> None:
        self._file_path = file_path
        self._lock = threading.RLock()
        self._reserved_usernames = {
            username.strip().lower() for username in reserved_usernames
        }
        self._accounts = self._load()
        self._dummy_salt = secrets.token_bytes(16)
        self._dummy_hash = self._hash_password(
            "not-a-real-password",
            self._dummy_salt,
            PASSWORD_HASH_ITERATIONS,
        )

    def register(
        self,
        *,
        name: str,
        username: str,
        password: str,
        confirm_password: str,
    ) -> TeacherAccount:
        """Validate and persist a new teacher account."""
        cleaned_name = name.strip()
        cleaned_username = username.strip().lower()
        if not 2 <= len(cleaned_name) <= 80:
            raise ValueError("Name must be between 2 and 80 characters.")
        if not USERNAME_PATTERN.fullmatch(cleaned_username):
            raise ValueError(
                "Username must be 3–32 characters using letters, numbers, "
                "dots, underscores, or hyphens."
            )
        if cleaned_username in self._reserved_usernames:
            raise DuplicateTeacherError("That username is already in use.")
        if not PASSWORD_MIN_LENGTH <= len(password) <= PASSWORD_MAX_LENGTH:
            raise ValueError(
                f"Password must be {PASSWORD_MIN_LENGTH}–"
                f"{PASSWORD_MAX_LENGTH} characters long."
            )
        if password.isspace():
            raise ValueError("Password cannot contain only spaces.")
        if password != confirm_password:
            raise ValueError("The passwords do not match.")

        with self._lock:
            if cleaned_username in self._accounts:
                raise DuplicateTeacherError(
                    "That username is already in use."
                )
            salt = secrets.token_bytes(16)
            account = TeacherAccount(
                id=uuid.uuid4().hex,
                name=cleaned_name,
                username=cleaned_username,
                salt=salt.hex(),
                password_hash=self._hash_password(
                    password,
                    salt,
                    PASSWORD_HASH_ITERATIONS,
                ).hex(),
                iterations=PASSWORD_HASH_ITERATIONS,
                created_at=datetime.now(timezone.utc).isoformat(),
            )
            updated_accounts = {**self._accounts, cleaned_username: account}
            self._persist(updated_accounts)
            self._accounts = updated_accounts
        return account

    def verify(self, username: str, password: str) -> bool:
        """Check credentials without exposing stored password values."""
        normalized_username = username.strip().lower()
        with self._lock:
            account = self._accounts.get(normalized_username)
        if account is None:
            candidate = self._hash_password(
                password,
                self._dummy_salt,
                PASSWORD_HASH_ITERATIONS,
            )
            hmac.compare_digest(candidate, self._dummy_hash)
            return False

        candidate = self._hash_password(
            password,
            bytes.fromhex(account.salt),
            account.iterations,
        )
        return hmac.compare_digest(
            candidate,
            bytes.fromhex(account.password_hash),
        )

    def _load(self) -> dict[str, TeacherAccount]:
        if not self._file_path.exists():
            return {}
        payload = json.loads(self._file_path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict) or not isinstance(
            payload.get("teachers"), list
        ):
            raise ValueError("Teacher account storage has an invalid format.")

        accounts: dict[str, TeacherAccount] = {}
        for record in payload["teachers"]:
            if not isinstance(record, dict):
                raise ValueError("Teacher account storage has an invalid entry.")
            try:
                account = TeacherAccount(
                    id=str(record["id"]),
                    name=str(record["name"]),
                    username=str(record["username"]),
                    salt=str(record["salt"]),
                    password_hash=str(record["passwordHash"]),
                    iterations=int(record["iterations"]),
                    created_at=str(record["createdAt"]),
                )
                salt_bytes = bytes.fromhex(account.salt)
                hash_bytes = bytes.fromhex(account.password_hash)
                if (
                    not USERNAME_PATTERN.fullmatch(account.username)
                    or account.username != account.username.lower()
                    or len(salt_bytes) != 16
                    or len(hash_bytes) != 32
                    or not 100_000 <= account.iterations <= 1_000_000
                ):
                    raise ValueError("Invalid teacher account record.")
            except (KeyError, TypeError, ValueError) as error:
                raise ValueError(
                    "Teacher account storage has an invalid entry."
                ) from error
            normalized_username = account.username.lower()
            if normalized_username in accounts:
                raise ValueError(
                    "Teacher account storage contains duplicate usernames."
                )
            accounts[normalized_username] = account
        return accounts

    def _persist(self, accounts: dict[str, TeacherAccount]) -> None:
        self._file_path.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=".teachers-",
            suffix=".tmp",
            dir=self._file_path.parent,
            text=True,
        )
        temporary_path = Path(temporary_name)
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as output:
                json.dump(
                    {"teachers": [
                        account.to_record()
                        for account in accounts.values()
                    ]},
                    output,
                    ensure_ascii=False,
                    indent=2,
                )
                output.write("\n")
                output.flush()
                os.fsync(output.fileno())
            os.chmod(temporary_path, 0o600)
            os.replace(temporary_path, self._file_path)
        finally:
            temporary_path.unlink(missing_ok=True)

    @staticmethod
    def _hash_password(
        password: str,
        salt: bytes,
        iterations: int,
    ) -> bytes:
        return hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            salt,
            iterations,
        )

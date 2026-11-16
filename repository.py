"""Persistent catalog and PDF storage for the local portal."""

from __future__ import annotations

import json
import os
import threading
import uuid
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

from catalog import Catalog, Material, Subject

MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_FOLDER_NAME_LENGTH = 100
MAX_SUBJECT_NAME_LENGTH = 80
MAX_SUBJECT_CODE_LENGTH = 32
MAX_SUBJECT_DESCRIPTION_LENGTH = 200
MAX_SUBJECT_ICON_LENGTH = 12
MAX_TITLE_LENGTH = 200
MAX_DESCRIPTION_LENGTH = 2000
MAX_FILE_NAME_LENGTH = 255


class PortalRepository:
    """Own catalog persistence and uploaded PDF files."""

    def __init__(self, catalog_path: Path, upload_dir: Path) -> None:
        self._catalog_path = catalog_path
        self._upload_dir = upload_dir
        self._lock = threading.RLock()
        self._catalog = Catalog.load(catalog_path)

    @property
    def catalog(self) -> Catalog:
        """Return the current immutable catalog snapshot."""
        with self._lock:
            return self._catalog

    def add_pdf(
        self,
        *,
        title: str,
        subject: str,
        folder: str,
        description: str,
        file_name: str,
        content: bytes,
    ) -> Material:
        """Validate and persist a PDF and its catalog record."""
        cleaned_title = self._clean_title(title)
        cleaned_description = self._clean_description(description)
        cleaned_file_name = self._validate_pdf(file_name, content)
        material_id = str(uuid.uuid4())
        material = Material(
            id=material_id,
            title=cleaned_title,
            subject=subject,
            folder=folder,
            description=cleaned_description,
            file_name=cleaned_file_name,
            file_size=len(content),
            pdf_url=f"/api/files/{material_id}",
            created_at=datetime.now(timezone.utc).isoformat(),
        )

        with self._lock:
            updated_catalog = self._catalog.with_material(material)
            self._upload_dir.mkdir(parents=True, exist_ok=True)
            file_path = self._upload_dir / f"{material_id}.pdf"
            self._atomic_write(file_path, content)
            try:
                self._persist_catalog(updated_catalog)
            except OSError:
                file_path.unlink(missing_ok=True)
                raise
            self._catalog = updated_catalog

        return material

    def add_folder(self, subject: str, folder_name: str) -> str:
        """Persist a new folder under an existing subject."""
        cleaned_name = folder_name.strip()
        if not cleaned_name:
            raise ValueError("Enter a folder name.")
        if len(cleaned_name) > MAX_FOLDER_NAME_LENGTH:
            raise ValueError(
                "Folder names must be "
                f"{MAX_FOLDER_NAME_LENGTH} characters or fewer."
            )

        with self._lock:
            updated_catalog = self._catalog.with_folder(
                subject,
                cleaned_name,
            )
            self._persist_catalog(updated_catalog)
            self._catalog = updated_catalog

        return cleaned_name

    def add_subject(
        self,
        *,
        name: str,
        code: str,
        description: str,
        icon: str,
        first_folder: str = "",
    ) -> Subject:
        """Create a subject and optionally its first folder."""
        cleaned_name = self._clean_required_text(
            name,
            "subject name",
            MAX_SUBJECT_NAME_LENGTH,
        )
        cleaned_code = self._clean_required_text(
            code,
            "subject code",
            MAX_SUBJECT_CODE_LENGTH,
        )
        cleaned_icon = self._clean_required_text(
            icon,
            "subject icon",
            MAX_SUBJECT_ICON_LENGTH,
        )
        cleaned_description = description.strip()
        if len(cleaned_description) > MAX_SUBJECT_DESCRIPTION_LENGTH:
            raise ValueError(
                "Subject descriptions must be "
                f"{MAX_SUBJECT_DESCRIPTION_LENGTH} characters or fewer."
            )
        cleaned_first_folder = first_folder.strip()
        if len(cleaned_first_folder) > MAX_FOLDER_NAME_LENGTH:
            raise ValueError(
                "Folder names must be "
                f"{MAX_FOLDER_NAME_LENGTH} characters or fewer."
            )

        subject = Subject(
            name=cleaned_name,
            code=cleaned_code,
            description=cleaned_description,
            icon=cleaned_icon,
            folders=(cleaned_first_folder,) if cleaned_first_folder else (),
        )
        with self._lock:
            updated_catalog = self._catalog.with_subject(subject)
            self._persist_catalog(updated_catalog)
            self._catalog = updated_catalog
        return subject

    def delete_folder(self, subject: str, folder_name: str) -> int:
        """Remove a folder, its metadata, and locally stored PDFs."""
        with self._lock:
            removed_materials = tuple(
                material for material in self._catalog.materials
                if material.subject == subject
                and material.folder == folder_name
            )
            updated_catalog = self._catalog.without_folder(
                subject,
                folder_name,
            )
            self._persist_catalog(updated_catalog)
            self._catalog = updated_catalog
            self._remove_uploaded_files(removed_materials)
        return len(removed_materials)

    def update_material(
        self,
        material_id: str,
        *,
        title: str,
        folder: str,
        description: str,
    ) -> Material:
        """Update a document title, folder, and description."""
        cleaned_title = self._clean_title(title)
        cleaned_description = self._clean_description(description)
        with self._lock:
            current = self._find_material(material_id)
            updated_material = replace(
                current,
                title=cleaned_title,
                folder=folder,
                description=cleaned_description,
            )
            updated_catalog = self._catalog.with_updated_material(
                updated_material
            )
            self._persist_catalog(updated_catalog)
            self._catalog = updated_catalog
        return updated_material

    def delete_material(self, material_id: str) -> Material:
        """Remove a document record and its local PDF, if locally stored."""
        with self._lock:
            material = self._find_material(material_id)
            updated_catalog = self._catalog.without_material(material_id)
            self._persist_catalog(updated_catalog)
            self._catalog = updated_catalog
            self._remove_uploaded_files((material,))
        return material

    def replace_pdf(
        self,
        material_id: str,
        *,
        file_name: str,
        content: bytes,
    ) -> Material:
        """Replace a document PDF while retaining its catalog identity."""
        cleaned_file_name = self._validate_pdf(file_name, content)
        with self._lock:
            current = self._find_material(material_id)
            updated_material = replace(
                current,
                file_name=cleaned_file_name,
                file_size=len(content),
                pdf_url=f"/api/files/{material_id}",
            )
            updated_catalog = self._catalog.with_updated_material(
                updated_material
            )
            self._upload_dir.mkdir(parents=True, exist_ok=True)
            file_path = self._upload_dir / f"{material_id}.pdf"
            old_content = file_path.read_bytes() if file_path.is_file() else None
            self._atomic_write(file_path, content)
            try:
                self._persist_catalog(updated_catalog)
            except OSError:
                if old_content is None:
                    file_path.unlink(missing_ok=True)
                else:
                    self._atomic_write(file_path, old_content)
                raise
            self._catalog = updated_catalog
        return updated_material

    @staticmethod
    def _clean_required_text(value: str, label: str, limit: int) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError(f"Enter a {label}.")
        if len(cleaned) > limit:
            raise ValueError(
                f"{label.capitalize()}s must be {limit} characters or fewer."
            )
        return cleaned

    @staticmethod
    def _clean_title(title: str) -> str:
        cleaned = title.strip()
        if not cleaned:
            raise ValueError("Enter a document title.")
        if len(cleaned) > MAX_TITLE_LENGTH:
            raise ValueError(
                f"Document titles must be {MAX_TITLE_LENGTH} characters "
                "or fewer."
            )
        return cleaned

    @staticmethod
    def _clean_description(description: str) -> str:
        cleaned = description.strip()
        if len(cleaned) > MAX_DESCRIPTION_LENGTH:
            raise ValueError(
                f"Descriptions must be {MAX_DESCRIPTION_LENGTH:,} "
                "characters or fewer."
            )
        return cleaned

    @staticmethod
    def _validate_pdf(file_name: str, content: bytes) -> str:
        cleaned_name = Path(file_name.replace("\\", "/")).name
        if not cleaned_name or len(cleaned_name) > MAX_FILE_NAME_LENGTH:
            raise ValueError("Choose a PDF with a valid file name.")
        if not cleaned_name.lower().endswith(".pdf"):
            raise ValueError("Only PDF files can be uploaded.")
        if not content:
            raise ValueError("The selected PDF is empty.")
        if len(content) > MAX_UPLOAD_BYTES:
            limit_mib = MAX_UPLOAD_BYTES // (1024 * 1024)
            raise ValueError(
                f"The PDF exceeds the {limit_mib} MiB upload limit."
            )
        if not content.startswith(b"%PDF-"):
            raise ValueError("The selected file is not a valid PDF.")
        return cleaned_name

    def _find_material(self, material_id: str) -> Material:
        try:
            normalized_id = str(UUID(material_id))
        except ValueError as error:
            raise ValueError("Invalid document ID.") from error
        if normalized_id != material_id:
            raise ValueError("Invalid document ID.")
        material = next(
            (item for item in self._catalog.materials if item.id == material_id),
            None,
        )
        if material is None:
            raise ValueError(f"Unknown document: {material_id}")
        return material

    def _remove_uploaded_files(self, materials: tuple[Material, ...]) -> None:
        for material in materials:
            file_path = self._local_file_path(material)
            if file_path is not None:
                file_path.unlink(missing_ok=True)

    def _local_file_path(self, material: Material) -> Path | None:
        expected_url = f"/api/files/{material.id}"
        if material.pdf_url != expected_url:
            return None
        try:
            normalized_id = str(UUID(material.id))
        except ValueError:
            return None
        if normalized_id != material.id:
            return None
        return self._upload_dir / f"{normalized_id}.pdf"

    def uploaded_file(
        self, material_id: str
    ) -> tuple[Material, Path] | None:
        """Resolve an uploaded material to its stored file, if present."""
        try:
            normalized_id = str(UUID(material_id))
        except ValueError:
            return None
        if normalized_id != material_id:
            return None

        with self._lock:
            material = next(
                (
                    item
                    for item in self._catalog.materials
                    if item.id == normalized_id
                ),
                None,
            )
            if material is None or material.pdf_url != (
                f"/api/files/{normalized_id}"
            ):
                return None
            file_path = self._upload_dir / f"{normalized_id}.pdf"
            if not file_path.is_file():
                return None
            return material, file_path

    def _persist_catalog(self, catalog: Catalog) -> None:
        self._catalog_path.parent.mkdir(parents=True, exist_ok=True)
        serialized = json.dumps(
            catalog.public_payload(),
            ensure_ascii=False,
            indent=2,
        ) + "\n"
        self._atomic_write(
            self._catalog_path,
            serialized.encode("utf-8"),
        )

    @staticmethod
    def _atomic_write(destination: Path, content: bytes) -> None:
        temporary = destination.with_name(
            f".{destination.name}.{uuid.uuid4().hex}.tmp"
        )
        try:
            with temporary.open("xb") as file_obj:
                file_obj.write(content)
                file_obj.flush()
                os.fsync(file_obj.fileno())
            os.replace(temporary, destination)
        finally:
            temporary.unlink(missing_ok=True)

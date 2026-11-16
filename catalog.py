"""Read and validate the local demo catalog."""

from __future__ import annotations

import json
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Mapping


def _mapping(value: object, label: str) -> Mapping[str, object]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    if not all(isinstance(key, str) for key in value):
        raise ValueError(f"{label} keys must be strings")
    return value


def _string(data: Mapping[str, object], key: str, label: str) -> str:
    value = data.get(key)
    if not isinstance(value, str):
        raise ValueError(f"{label}.{key} must be a string")
    return value


def _string_list(value: object, label: str) -> tuple[str, ...]:
    if not isinstance(value, list) or not all(
        isinstance(item, str) for item in value
    ):
        raise ValueError(f"{label} must be a list of strings")
    return tuple(value)


@dataclass(frozen=True)
class Subject:
    """A subject card and its directory names."""

    name: str
    code: str
    description: str
    icon: str
    folders: tuple[str, ...]

    @classmethod
    def from_json(cls, value: object) -> Subject:
        data = _mapping(value, "subject")
        folders = _string_list(data.get("folders"), "subject.folders")
        if len(set(folders)) != len(folders):
            raise ValueError("subject folders must be unique")
        return cls(
            name=_string(data, "name", "subject"),
            code=_string(data, "code", "subject"),
            description=_string(data, "description", "subject"),
            icon=_string(data, "icon", "subject"),
            folders=folders,
        )

    def to_json(self) -> dict[str, object]:
        return {
            "name": self.name,
            "code": self.code,
            "description": self.description,
            "icon": self.icon,
            "folders": list(self.folders),
        }


@dataclass(frozen=True)
class Material:
    """Metadata for one study document."""

    id: str
    title: str
    subject: str
    folder: str
    description: str
    file_name: str
    file_size: int
    pdf_url: str
    created_at: str

    @classmethod
    def from_json(cls, value: object) -> Material:
        data = _mapping(value, "material")
        file_size = data.get("fileSize")
        if isinstance(file_size, bool) or not isinstance(file_size, int):
            raise ValueError("material.fileSize must be an integer")
        if file_size < 0:
            raise ValueError("material.fileSize cannot be negative")
        return cls(
            id=_string(data, "id", "material"),
            title=_string(data, "title", "material"),
            subject=_string(data, "subject", "material"),
            folder=_string(data, "folder", "material"),
            description=_string(data, "description", "material"),
            file_name=_string(data, "fileName", "material"),
            file_size=file_size,
            pdf_url=_string(data, "pdfUrl", "material"),
            created_at=_string(data, "createdAt", "material"),
        )

    def to_json(self) -> dict[str, object]:
        return {
            "id": self.id,
            "title": self.title,
            "subject": self.subject,
            "folder": self.folder,
            "description": self.description,
            "fileName": self.file_name,
            "fileSize": self.file_size,
            "pdfUrl": self.pdf_url,
            "createdAt": self.created_at,
        }


@dataclass(frozen=True)
class Catalog:
    """Validated catalog data served by the demo backend."""

    subjects: tuple[Subject, ...]
    materials: tuple[Material, ...]

    @classmethod
    def load(cls, path: Path) -> Catalog:
        raw: object = json.loads(path.read_text(encoding="utf-8"))
        data = _mapping(raw, "catalog")
        raw_subjects = data.get("subjects")
        raw_materials = data.get("materials")
        if not isinstance(raw_subjects, list):
            raise ValueError("catalog.subjects must be a list")
        if not isinstance(raw_materials, list):
            raise ValueError("catalog.materials must be a list")

        subjects = tuple(Subject.from_json(item) for item in raw_subjects)
        materials = tuple(Material.from_json(item) for item in raw_materials)
        subject_by_name = {subject.name: subject for subject in subjects}

        if len(subject_by_name) != len(subjects):
            raise ValueError("subject names must be unique")
        if len({material.id for material in materials}) != len(materials):
            raise ValueError("material IDs must be unique")

        for material in materials:
            subject = subject_by_name.get(material.subject)
            if subject is None:
                raise ValueError(
                    f"material {material.id} uses unknown subject "
                    f"{material.subject!r}"
                )
            if material.folder not in subject.folders:
                raise ValueError(
                    f"material {material.id} uses unknown folder "
                    f"{material.folder!r}"
                )

        return cls(subjects=subjects, materials=materials)

    def public_payload(self) -> dict[str, object]:
        return {
            "subjects": [subject.to_json() for subject in self.subjects],
            "materials": [material.to_json() for material in self.materials],
        }

    def hierarchy_payload(self) -> list[dict[str, object]]:
        return [
            {
                "subject": subject.name,
                "folders": list(subject.folders),
            }
            for subject in self.subjects
        ]

    def materials_payload(
        self, subject_name: str | None = None
    ) -> list[dict[str, object]]:
        if subject_name is not None and subject_name not in {
            subject.name for subject in self.subjects
        }:
            raise KeyError(subject_name)

        materials = (
            self.materials
            if subject_name is None
            else tuple(
                material
                for material in self.materials
                if material.subject == subject_name
            )
        )
        return [material.to_json() for material in materials]

    def with_material(self, material: Material) -> Catalog:
        """Return a catalog containing a validated additional material."""
        subject_by_name = {subject.name: subject for subject in self.subjects}
        subject = subject_by_name.get(material.subject)
        if subject is None:
            raise ValueError(f"Unknown subject: {material.subject}")
        if material.folder not in subject.folders:
            raise ValueError(
                f"Unknown folder {material.folder!r} for {material.subject}"
            )
        if any(item.id == material.id for item in self.materials):
            raise ValueError(f"Duplicate material ID: {material.id}")
        return Catalog(
            subjects=self.subjects,
            materials=(*self.materials, material),
        )

    def with_subject(self, subject: Subject) -> Catalog:
        """Return a catalog containing a new subject partition."""
        if any(
            item.name.casefold() == subject.name.casefold()
            for item in self.subjects
        ):
            raise ValueError(
                f"A subject named {subject.name!r} already exists."
            )
        if any(
            item.code.casefold() == subject.code.casefold()
            for item in self.subjects
        ):
            raise ValueError(
                f"A subject with code {subject.code!r} already exists."
            )
        return Catalog(
            subjects=(*self.subjects, subject),
            materials=self.materials,
        )

    def without_folder(self, subject_name: str, folder_name: str) -> Catalog:
        """Return a catalog with a folder and its material records removed."""
        subject = next(
            (item for item in self.subjects if item.name == subject_name),
            None,
        )
        if subject is None:
            raise ValueError(f"Unknown subject: {subject_name}")
        if folder_name not in subject.folders:
            raise ValueError(
                f"Unknown folder {folder_name!r} for {subject_name}"
            )

        updated_subject = replace(
            subject,
            folders=tuple(
                folder for folder in subject.folders
                if folder != folder_name
            ),
        )
        updated_subjects = tuple(
            updated_subject if item.name == subject_name else item
            for item in self.subjects
        )
        updated_materials = tuple(
            material for material in self.materials
            if not (
                material.subject == subject_name
                and material.folder == folder_name
            )
        )
        return Catalog(
            subjects=updated_subjects,
            materials=updated_materials,
        )

    def without_material(self, material_id: str) -> Catalog:
        """Return a catalog without the requested document."""
        if not any(item.id == material_id for item in self.materials):
            raise ValueError(f"Unknown document: {material_id}")
        return Catalog(
            subjects=self.subjects,
            materials=tuple(
                item for item in self.materials if item.id != material_id
            ),
        )

    def with_updated_material(self, material: Material) -> Catalog:
        """Return a catalog with an existing document replaced."""
        if not any(item.id == material.id for item in self.materials):
            raise ValueError(f"Unknown document: {material.id}")
        subject = next(
            (item for item in self.subjects if item.name == material.subject),
            None,
        )
        if subject is None:
            raise ValueError(f"Unknown subject: {material.subject}")
        if material.folder not in subject.folders:
            raise ValueError(
                f"Unknown folder {material.folder!r} for {material.subject}"
            )
        return Catalog(
            subjects=self.subjects,
            materials=tuple(
                material if item.id == material.id else item
                for item in self.materials
            ),
        )

    def with_folder(self, subject_name: str, folder_name: str) -> Catalog:
        """Return a catalog with a new folder under an existing subject."""
        subject = next(
            (
                item
                for item in self.subjects
                if item.name == subject_name
            ),
            None,
        )
        if subject is None:
            raise ValueError(f"Unknown subject: {subject_name}")
        if not folder_name.strip():
            raise ValueError("Folder names cannot be empty.")
        if any(
            item.casefold() == folder_name.casefold()
            for item in subject.folders
        ):
            raise ValueError(
                f"A folder named {folder_name!r} already exists "
                f"under {subject_name}."
            )

        updated_subject = replace(
            subject,
            folders=(*subject.folders, folder_name),
        )
        updated_subjects = tuple(
            updated_subject if item.name == subject_name else item
            for item in self.subjects
        )
        return Catalog(
            subjects=updated_subjects,
            materials=self.materials,
        )

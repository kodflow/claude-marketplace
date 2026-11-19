"""Validate portable JSON Schema contracts against local resources only."""

from __future__ import annotations

from collections.abc import Iterator
import json

from jsonschema import Draft202012Validator, SchemaError
from referencing import Registry
from referencing.exceptions import Unresolvable
from referencing.jsonschema import DRAFT202012


# A bare registry fails retrieval instead of installing jsonschema's legacy
# remote retrieval fallback. Local resources are still indexed normally.
LOCAL_REGISTRY = Registry()
SCHEMA_MAPS = (
    "$defs", "definitions", "properties", "patternProperties", "dependentSchemas", "dependencies",
)
SCHEMA_ARRAYS = ("allOf", "anyOf", "oneOf", "prefixItems")
SCHEMA_CHILDREN = (
    "additionalItems", "additionalProperties", "contains", "contentSchema", "else", "if",
    "items", "not", "propertyNames", "then", "unevaluatedItems", "unevaluatedProperties",
)


def offline_validator(schema: dict) -> Draft202012Validator:
    return Draft202012Validator(schema, registry=LOCAL_REGISTRY)


def _subschemas(value: dict) -> Iterator[object]:
    for key in SCHEMA_MAPS:
        children = value.get(key)
        if isinstance(children, dict):
            yield from children.values()
    for key in SCHEMA_ARRAYS:
        children = value.get(key)
        if isinstance(children, list):
            yield from children
    for key in SCHEMA_CHILDREN:
        if key in value:
            yield value[key]


def _check_meta_schema(schema: dict | bool, target: str | None = None) -> None:
    try:
        Draft202012Validator.check_schema(schema)
    except SchemaError as error:
        prefix = "" if target is None else f"invalid JSON Schema reference target {target!r}: "
        raise ValueError(prefix + error.message) from error


def check_contract_schema(schema: dict) -> None:
    """Inspect schema positions and follow fragment targets, even under annotations."""
    # Drop YAML alias identity so a visited node represents a unique location
    # in the document, including when two locations share source text.
    try:
        document = json.loads(json.dumps(schema, allow_nan=False))
        if document != schema:
            raise ValueError("object keys must be strings")
    except (TypeError, ValueError) as error:
        raise ValueError(f"schema must be JSON-compatible: {error}") from error
    _check_meta_schema(document)

    root = DRAFT202012.create_resource(document)
    queue = [(document, LOCAL_REGISTRY.resolver_with_root(root))]
    visited = set()
    checked_targets = {id(document)}
    while queue:
        node, resolver = queue.pop()
        if isinstance(node, bool):
            continue
        if not isinstance(node, dict) or id(node) in visited:
            continue
        visited.add(id(node))

        for key in ("$ref", "$dynamicRef", "$recursiveRef"):
            if key not in node:
                continue
            fragment = node[key]
            if not isinstance(fragment, str) or not fragment.startswith("#"):
                raise ValueError(f"external JSON Schema reference must stay in its document: {fragment!r}")
            try:
                target = resolver.lookup(fragment)
            except (Unresolvable, TypeError, ValueError) as error:
                raise ValueError(f"unresolved local JSON Schema reference: {fragment!r}") from error
            if not isinstance(target.contents, (dict, bool)):
                raise ValueError(f"local JSON Schema reference is not a schema: {fragment!r}")
            # Meta-schema validation of the root does not cover literals in
            # annotations. A reference activates such a literal as a schema.
            target_id = id(target.contents)
            if target_id not in checked_targets:
                _check_meta_schema(target.contents, fragment)
                checked_targets.add(target_id)
            queue.append((target.contents, target.resolver))

        # Examples and other literal data are left alone unless a fragment
        # explicitly references them as active schema content.
        for child in _subschemas(node):
            if isinstance(child, dict):
                child_resource = DRAFT202012.create_resource(child)
                queue.append((child, resolver.in_subresource(child_resource)))

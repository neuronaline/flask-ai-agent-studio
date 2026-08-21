"""Phase 5 — Clarification contract unification.

Asserts that the ask_clarifying_question tool:
- advertises the full canonical schema (id, input_type, required, options as
  objects, depends_on);
- normalizes model arguments and stored payloads into the same shape;
- preserves object options end-to-end;
- rejects duplicate/forward/cyclic dependencies;
- preserves legacy string options for already-stored messages.
"""

from __future__ import annotations

import pytest
from jsonschema import Draft7Validator

from agent.agent import _normalize_clarification_payload
from core.db import extract_pending_clarification

REMOVED_KEYS = {"maxItems"}  # placeholder, not used


class TestSchemaContract:
    """The ask_clarifying_question schema must match the canonical contract."""

    def _schema(self):
        from lib.tool_registry import TOOL_SPEC_BY_NAME

        return TOOL_SPEC_BY_NAME["ask_clarifying_question"]["parameters"]

    def test_root_has_additional_properties_false(self):
        assert self._schema().get("additionalProperties") is False

    def test_questions_items_require_canonical_fields(self):
        items = self._schema()["properties"]["questions"]["items"]
        assert set(items.get("required", [])) == {"id", "label", "input_type"}
        assert items.get("additionalProperties") is False

    def test_options_use_object_shape(self):
        items = self._schema()["properties"]["questions"]["items"]["properties"]["options"]["items"]
        assert items.get("type") == "object"
        assert set(items.get("required", [])) == {"label", "value"}
        assert items.get("additionalProperties") is False

    def test_depends_on_is_object(self):
        depends_on = (
            self._schema()["properties"]["questions"]["items"]["properties"]["depends_on"]
        )
        assert depends_on.get("type") == "object"
        assert set(depends_on.get("required", [])) == {"question_id", "values"}
        assert depends_on.get("additionalProperties") is False

    def test_input_type_enum_lists_supported_inputs(self):
        enum_values = (
            self._schema()["properties"]["questions"]["items"]["properties"]["input_type"].get("enum")
        )
        assert enum_values == ["text", "single_select", "multi_select"]


class TestSchemaValidation:
    """The canonical payload must validate against the advertised schema."""

    def _validate(self, payload):
        from lib.tool_registry import TOOL_SPEC_BY_NAME

        schema = TOOL_SPEC_BY_NAME["ask_clarifying_question"]["parameters"]
        validator = Draft7Validator(schema)
        errors = list(validator.iter_errors(payload))
        return errors

    def test_object_options_validate(self):
        payload = {
            "questions": [
                {
                    "id": "scope",
                    "label": "Which scope?",
                    "input_type": "single_select",
                    "options": [
                        {
                            "label": "Conversation",
                            "value": "conversation",
                            "description": "Use only the active conversation.",
                        },
                        {"label": "Project", "value": "project"},
                    ],
                }
            ]
        }
        assert not self._validate(payload)

    def test_depends_on_validates(self):
        payload = {
            "questions": [
                {
                    "id": "mode",
                    "label": "Mode",
                    "input_type": "single_select",
                    "options": [
                        {"label": "Advanced", "value": "advanced"},
                        {"label": "Simple", "value": "simple"},
                    ],
                },
                {
                    "id": "scope",
                    "label": "Which scope?",
                    "input_type": "single_select",
                    "depends_on": {
                        "question_id": "mode",
                        "values": ["advanced"],
                    },
                    "options": [{"label": "X", "value": "x"}],
                },
            ]
        }
        assert not self._validate(payload)

    def test_missing_id_fails_schema(self):
        payload = {
            "questions": [
                {
                    "label": "Hello?",
                    "input_type": "text",
                }
            ]
        }
        errors = self._validate(payload)
        assert errors, "Expected validation error for missing id"

    def test_missing_label_fails_schema(self):
        payload = {
            "questions": [
                {
                    "id": "q",
                    "input_type": "text",
                }
            ]
        }
        errors = self._validate(payload)
        assert errors, "Expected validation error for missing label"

    def test_additional_properties_rejected(self):
        payload = {
            "questions": [
                {
                    "id": "q",
                    "label": "Hello",
                    "input_type": "text",
                    "extra": "not allowed",
                }
            ]
        }
        errors = self._validate(payload)
        assert errors, "Expected validation error for additionalProperties"


class TestNormalization:
    """`_normalize_clarification_payload` preserves the canonical fields."""

    def test_preserves_object_options(self):
        payload = _normalize_clarification_payload(
            {
                "questions": [
                    {
                        "id": "scope",
                        "label": "Pick scope",
                        "input_type": "single_select",
                        "options": [
                            {"label": "Conversation", "value": "conversation"},
                            {"label": "Project", "value": "project"},
                        ],
                    }
                ]
            }
        )

        question = payload["questions"][0]
        assert question["id"] == "scope"
        assert question["input_type"] == "single_select"
        assert question["options"] == [
            {"label": "Conversation", "value": "conversation", "description": ""},
            {"label": "Project", "value": "project", "description": ""},
        ]

    def test_preserves_placeholder_and_allow_free_text(self):
        payload = _normalize_clarification_payload(
            {
                "questions": [
                    {
                        "id": "topic",
                        "label": "Topic?",
                        "input_type": "single_select",
                        "placeholder": "Pick one",
                        "allow_free_text": True,
                        "options": [{"label": "A", "value": "a"}],
                    }
                ]
            }
        )
        question = payload["questions"][0]
        assert question["placeholder"] == "Pick one"
        assert question["allow_free_text"] is True

    def test_preserves_required_false(self):
        payload = _normalize_clarification_payload(
            {
                "questions": [
                    {
                        "id": "followup",
                        "label": "Anything else?",
                        "input_type": "text",
                        "required": False,
                    }
                ]
            }
        )
        assert payload["questions"][0]["required"] is False

    def test_select_input_requires_options(self):
        import pytest

        with pytest.raises(ValueError):
            _normalize_clarification_payload(
                {
                    "questions": [
                        {
                            "id": "scope",
                            "label": "Pick scope",
                            "input_type": "single_select",
                        }
                    ]
                }
            )

    def test_duplicate_ids_dropped(self):
        payload = _normalize_clarification_payload(
            {
                "questions": [
                    {"id": "scope", "label": "A", "input_type": "text"},
                    {"id": "scope", "label": "B", "input_type": "text"},
                ]
            }
        )
        ids = [q["id"] for q in payload["questions"]]
        assert ids == ["scope"]

    def test_self_dependency_dropped(self):
        payload = _normalize_clarification_payload(
            {
                "questions": [
                    {
                        "id": "loop",
                        "label": "Looping?",
                        "input_type": "text",
                        "depends_on": {"question_id": "loop", "values": ["x"]},
                    }
                ]
            }
        )
        assert "depends_on" not in payload["questions"][0]

    def test_forward_dependency_dropped(self):
        payload = _normalize_clarification_payload(
            {
                "questions": [
                    {
                        "id": "later",
                        "label": "Later",
                        "input_type": "text",
                        "depends_on": {"question_id": "later2", "values": ["x"]},
                    },
                    {"id": "later2", "label": "Later 2", "input_type": "text"},
                ]
            }
        )
        assert "depends_on" not in payload["questions"][0]
        assert "depends_on" not in payload["questions"][1]

    def test_valid_dependency_preserved(self):
        payload = _normalize_clarification_payload(
            {
                "questions": [
                    {
                        "id": "mode",
                        "label": "Mode",
                        "input_type": "single_select",
                        "options": [
                            {"label": "Advanced", "value": "advanced"},
                            {"label": "Simple", "value": "simple"},
                        ],
                    },
                    {
                        "id": "scope",
                        "label": "Scope",
                        "input_type": "single_select",
                        "depends_on": {"question_id": "mode", "values": ["advanced"]},
                        "options": [{"label": "X", "value": "x"}],
                    },
                ]
            }
        )
        scope = next(q for q in payload["questions"] if q["id"] == "scope")
        assert scope["depends_on"] == {"question_id": "mode", "values": ["advanced"]}

    def test_invalid_input_type_dropped(self):
        with pytest.raises(ValueError):
            _normalize_clarification_payload(
                {
                    "questions": [
                        {
                            "id": "weird",
                            "label": "Weird",
                            "input_type": "checkbox",
                        }
                    ]
                }
            )

    def test_default_input_type_is_text(self):
        payload = _normalize_clarification_payload(
            {"questions": [{"id": "q", "label": "Hello"}]}
        )
        assert payload["questions"][0]["input_type"] == "text"

    def test_unique_ids_assigned_when_missing(self):
        payload = _normalize_clarification_payload(
            {
                "questions": [
                    {"label": "First", "input_type": "text"},
                    {"label": "Second", "input_type": "text"},
                ]
            }
        )
        ids = [q["id"] for q in payload["questions"]]
        assert len(set(ids)) == 2
        assert ids[0] != ids[1]


class TestStoredPayloadExtraction:
    """`extract_pending_clarification` upgrades legacy string options and preserves dependencies."""

    def test_legacy_string_options_become_object_options(self):
        pending = extract_pending_clarification(
            {
                "pending_clarification": {
                    "questions": [
                        {
                            "label": "Pick one",
                            "options": ["alpha", "beta"],
                        }
                    ]
                }
            }
        )
        question = pending["questions"][0]
        assert question["input_type"] == "text"
        # Legacy options are normalized to object form on read.
        assert question["options"] == [
            {"label": "alpha", "value": "alpha", "description": ""},
            {"label": "beta", "value": "beta", "description": ""},
        ]

    def test_object_options_survive_storage_round_trip(self):
        pending = extract_pending_clarification(
            {
                "pending_clarification": {
                    "questions": [
                        {
                            "id": "scope",
                            "label": "Scope",
                            "input_type": "single_select",
                            "options": [
                                {
                                    "label": "Conversation",
                                    "value": "conversation",
                                    "description": "Active conversation only.",
                                }
                            ],
                        }
                    ]
                }
            }
        )
        question = pending["questions"][0]
        assert question["options"][0]["value"] == "conversation"
        assert question["options"][0]["description"] == "Active conversation only."

    def test_dependency_targeting_missing_question_dropped(self):
        pending = extract_pending_clarification(
            {
                "pending_clarification": {
                    "questions": [
                        {
                            "id": "scope",
                            "label": "Scope",
                            "input_type": "text",
                            "depends_on": {"question_id": "missing", "values": ["x"]},
                        }
                    ]
                }
            }
        )
        assert "depends_on" not in pending["questions"][0]

    def test_self_dependency_dropped_on_read(self):
        pending = extract_pending_clarification(
            {
                "pending_clarification": {
                    "questions": [
                        {
                            "id": "loop",
                            "label": "Looping",
                            "input_type": "text",
                            "depends_on": {"question_id": "loop", "values": ["x"]},
                        }
                    ]
                }
            }
        )
        assert "depends_on" not in pending["questions"][0]

    def test_valid_dependency_survives_read(self):
        pending = extract_pending_clarification(
            {
                "pending_clarification": {
                    "questions": [
                        {
                            "id": "mode",
                            "label": "Mode",
                            "input_type": "single_select",
                            "options": [
                                {"label": "Advanced", "value": "advanced"},
                            ],
                        },
                        {
                            "id": "scope",
                            "label": "Scope",
                            "input_type": "single_select",
                            "depends_on": {"question_id": "mode", "values": ["advanced"]},
                            "options": [{"label": "X", "value": "x"}],
                        },
                    ]
                }
            }
        )
        scope = next(q for q in pending["questions"] if q["id"] == "scope")
        assert scope["depends_on"] == {"question_id": "mode", "values": ["advanced"]}

    def test_duplicate_id_dropped_on_read(self):
        pending = extract_pending_clarification(
            {
                "pending_clarification": {
                    "questions": [
                        {"id": "scope", "label": "First", "input_type": "text"},
                        {"id": "scope", "label": "Second", "input_type": "text"},
                    ]
                }
            }
        )
        ids = [q["id"] for q in pending["questions"]]
        assert ids == ["scope"]


class TestClarificationExecutor:
    """The ask_clarifying_question executor produces a canonical payload."""

    def test_executor_preserves_object_options(self):
        from agent.agent import _run_ask_clarifying_question

        result, _ = _run_ask_clarifying_question(
            {
                "questions": [
                    {
                        "id": "scope",
                        "label": "Which scope?",
                        "input_type": "single_select",
                        "options": [
                            {"label": "Conversation", "value": "conversation"},
                        ],
                    }
                ]
            },
            {},
        )
        question = result["clarification"]["questions"][0]
        assert question["input_type"] == "single_select"
        assert question["options"][0]["value"] == "conversation"

    def test_executor_strips_invalid_input_type(self):
        from agent.agent import _run_ask_clarifying_question

        with pytest.raises(ValueError):
            _run_ask_clarifying_question(
                {
                    "questions": [
                        {
                            "id": "weird",
                            "label": "Weird",
                            "input_type": "checkbox",
                        }
                    ]
                },
                {},
            )

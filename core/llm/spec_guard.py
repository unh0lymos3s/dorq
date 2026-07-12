"""Semantic guardrails for LLM-generated StrategySpecs.

Pydantic validates shape; this validates meaning — the indicator vocabulary,
parameter sanity, and that every entry/exit condition string will parse and
resolve under the engine's fixed condition grammar. Catching a bad spec here
(inside the generation retry loop, with the reason fed back to the model)
beats letting it surface later as an opaque backtest error.
"""

import re

from core.models.strategy import IndicatorDef, StrategySpec

class SpecGuardError(ValueError):
    """A structurally valid spec that fails semantic validation."""

_TICKER_RE = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")

# Mirrors the grammar in core/backtest/engine.py — keep in sync.
_CONDITION_RE = re.compile(r"^(?P<left>\w+)\s*(?P<op>>=|<=|>|<|==)\s*(?P<right>[\w.]+)$")
_AND_RE = re.compile(r"\bAND\b", re.IGNORECASE)
_OR_RE = re.compile(r"\bOR\b", re.IGNORECASE)

_RAW_COLUMNS = frozenset({"open", "high", "low", "close"})

# Required integer params per indicator, matching engine._compute_indicators.
_REQUIRED_PARAMS: dict[str, tuple[str, ...]] = {
    "SMA": ("period",),
    "EMA": ("period",),
    "RSI": ("period",),
    "MACD": ("fast", "slow", "signal"),
    "BB": ("period",),
    "ATR": ("period",),
    "STOCH": ("k", "d"),
    "ADX": ("period",),
}

_MAX_INDICATORS = 12
_MAX_CONDITIONS = 12
_MAX_CONDITION_LEN = 200
_MAX_ASSETS = 20
_PARAM_MIN, _PARAM_MAX = 1, 500


def _indicator_params(ind: IndicatorDef) -> dict[str, int]:
    name = ind.name.upper()
    required = _REQUIRED_PARAMS.get(name)
    if required is None:
        raise SpecGuardError(
            f"unsupported indicator {ind.name!r} — allowed: {', '.join(sorted(_REQUIRED_PARAMS))}"
        )
    out: dict[str, int] = {}
    for key in required:
        if key not in ind.params:
            raise SpecGuardError(f"indicator {name} is missing required param {key!r}")
        try:
            value = int(ind.params[key])
        except (TypeError, ValueError):
            raise SpecGuardError(f"indicator {name} param {key!r} must be an integer")
        if not _PARAM_MIN <= value <= _PARAM_MAX:
            raise SpecGuardError(
                f"indicator {name} param {key!r}={value} out of range "
                f"[{_PARAM_MIN}, {_PARAM_MAX}]"
            )
        out[key] = value
    return out


def _indicator_columns(ind: IndicatorDef) -> list[str]:
    """Column names this indicator makes available to conditions —
    mirrors engine._compute_indicators exactly."""
    name = ind.name.upper()
    p = _indicator_params(ind)
    if name in ("SMA", "EMA", "RSI", "ATR"):
        return [f"{name}_{p['period']}"]
    if name == "MACD":
        stem = f"{p['fast']}_{p['slow']}_{p['signal']}"
        return [f"MACD_{stem}", f"MACDs_{stem}"]
    if name == "BB":
        return [f"BBU_{p['period']}", f"BBM_{p['period']}", f"BBL_{p['period']}"]
    if name == "STOCH":
        return [f"STOCHK_{p['k']}_{p['d']}", f"STOCHD_{p['k']}_{p['d']}"]
    # ADX
    return [f"ADX_{p['period']}", f"DMP_{p['period']}", f"DMN_{p['period']}"]


def _check_operand(token: str, columns: frozenset[str], condition: str) -> None:
    if token in columns:
        return
    try:
        float(token)
    except ValueError:
        raise SpecGuardError(
            f"unknown signal {token!r} in condition {condition!r} — "
            "conditions may only reference declared indicator columns, "
            "open/high/low/close, or numbers"
        )


def _check_conditions(conditions: list[str], columns: frozenset[str], label: str) -> None:
    if not any(c.strip() for c in conditions):
        raise SpecGuardError(f"{label} must contain at least one condition")
    if len(conditions) > _MAX_CONDITIONS:
        raise SpecGuardError(f"too many {label} ({len(conditions)} > {_MAX_CONDITIONS})")
    for raw in conditions:
        if not raw.strip():
            continue
        if len(raw) > _MAX_CONDITION_LEN:
            raise SpecGuardError(f"{label} entry too long ({len(raw)} chars)")
        for or_part in _OR_RE.split(raw):
            atoms = [t.strip() for t in _AND_RE.split(or_part) if t.strip()]
            if not atoms:
                raise SpecGuardError(f"unparseable condition in {label}: {raw!r}")
            for atom in atoms:
                m = _CONDITION_RE.match(atom)
                if not m:
                    raise SpecGuardError(
                        f"unparseable condition in {label}: {atom!r} — expected "
                        "'<COLUMN> <op> <COLUMN|number>' with op in > < >= <= =="
                    )
                # Left side must be a column (comparing two literals is meaningless).
                if m.group("left") not in columns:
                    raise SpecGuardError(
                        f"unknown signal {m.group('left')!r} in condition {atom!r}"
                    )
                _check_operand(m.group("right"), columns, atom)


def validate_spec(spec: StrategySpec) -> None:
    """Raise SpecGuardError if the spec can't be run safely and deterministically."""
    if not spec.assets:
        raise SpecGuardError("assets must not be empty")
    if len(spec.assets) > _MAX_ASSETS:
        raise SpecGuardError(f"too many assets ({len(spec.assets)} > {_MAX_ASSETS})")
    for asset in spec.assets:
        if not _TICKER_RE.match(asset):
            raise SpecGuardError(
                f"invalid ticker {asset!r} — expected an uppercase symbol like SPY or BRK.B"
            )

    if len(spec.indicators) > _MAX_INDICATORS:
        raise SpecGuardError(f"too many indicators ({len(spec.indicators)} > {_MAX_INDICATORS})")

    columns = set(_RAW_COLUMNS)
    for ind in spec.indicators:
        columns.update(_indicator_columns(ind))
    frozen = frozenset(columns)

    _check_conditions(spec.entry_conditions, frozen, "entry_conditions")
    _check_conditions(spec.exit_conditions, frozen, "exit_conditions")

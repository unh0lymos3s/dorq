import numpy as np
import pandas as pd
import pandas_ta  # noqa: F401

from core.backtest.validator import validate_strategy_code

_SAFE_BUILTINS: dict = {
    "abs": abs, "all": all, "any": any, "bool": bool, "dict": dict,
    "enumerate": enumerate, "float": float, "int": int, "len": len,
    "list": list, "max": max, "min": min, "range": range, "round": round,
    "set": set, "str": str, "sum": sum, "tuple": tuple, "zip": zip,
    "isinstance": isinstance, "True": True, "False": False, "None": None,
    "print": print,
}

_NAMESPACE_BASE = {
    "pd": pd,
    "np": np,
    "pandas_ta": pandas_ta,
    "__builtins__": _SAFE_BUILTINS,
}

# Cache compiled bytecode by source — same LLM output is often retried/reused.
# Bounded by LRU semantics on the wrapper below.
from functools import lru_cache as _lru_cache


@_lru_cache(maxsize=32)
def _compile_strategy(source: str):
    # compile() once, then exec the code object on each call — avoids re-parsing.
    return compile(source, "<strategy>", "exec")


def _coerce_bool_df(df: pd.DataFrame) -> pd.DataFrame:
    """Cheapest path: skip allocation entirely when already bool with no NaNs."""
    # Fast path: every column is already bool dtype — nothing to do.
    if all(dt == np.bool_ for dt in df.dtypes):
        return df
    # Need a copy; combine fillna+astype using a single where + cast to avoid
    # double allocation. .fillna(False).astype(bool) materializes twice.
    return df.where(df.notna(), False).astype(bool, copy=False)


def exec_strategy(source: str, bars: dict) -> tuple[pd.DataFrame, pd.DataFrame]:
    validate_strategy_code(source)

    try:
        code_obj = _compile_strategy(source)
    except SyntaxError as exc:
        raise ValueError(f"strategy_exec_error: {exc}") from exc

    namespace = dict(_NAMESPACE_BASE)
    try:
        exec(code_obj, namespace)  # noqa: S102
    except Exception as exc:
        raise ValueError(f"strategy_exec_error: {exc}") from exc

    fn = namespace.get("strategy")
    if not callable(fn):
        raise ValueError("strategy_code did not define a callable 'strategy'")

    try:
        result = fn(bars)
    except Exception as exc:
        raise ValueError(f"strategy_exec_error: {exc}") from exc

    if not (isinstance(result, tuple) and len(result) == 2):
        raise ValueError("strategy() must return a 2-tuple (entries_df, exits_df)")

    entries_df, exits_df = result
    if not isinstance(entries_df, pd.DataFrame) or not isinstance(exits_df, pd.DataFrame):
        raise ValueError("entries_df and exits_df must both be pd.DataFrame")

    return _coerce_bool_df(entries_df), _coerce_bool_df(exits_df)

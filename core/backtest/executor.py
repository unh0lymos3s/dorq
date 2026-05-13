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


def exec_strategy(source: str, bars: dict) -> tuple[pd.DataFrame, pd.DataFrame]:
    validate_strategy_code(source)

    namespace = dict(_NAMESPACE_BASE)
    try:
        exec(source, namespace)  # noqa: S102
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

    return entries_df.fillna(False).astype(bool), exits_df.fillna(False).astype(bool)

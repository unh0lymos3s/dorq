import ast
from functools import lru_cache

_BLOCKED_NAMES = frozenset({
    "eval", "exec", "open", "__import__", "compile",
    "globals", "locals", "vars",
    "getattr", "setattr", "delattr",
    "breakpoint", "input",
})

_NS_NAMES = frozenset({"pd", "np", "pandas_ta"})


def _root_name(node: ast.expr) -> str | None:
    while isinstance(node, ast.Attribute):
        node = node.value
    return node.id if isinstance(node, ast.Name) else None


def _check_ns_attr_assign(target: ast.expr, lineno: int) -> None:
    if isinstance(target, ast.Attribute) and _root_name(target) in _NS_NAMES:
        raise ValueError(
            f"forbidden: assignment to namespace module attribute at line {lineno}"
        )


def _walk_and_check(tree: ast.AST) -> None:
    """Single-pass validation using ast.walk — avoids NodeVisitor's per-node
    method-dispatch overhead and the implicit generic_visit recursion."""
    # Local binds for tight-loop speed
    _Import = ast.Import
    _ImportFrom = ast.ImportFrom
    _Name = ast.Name
    _Load = ast.Load
    _Attribute = ast.Attribute
    _Assign = ast.Assign
    _AugAssign = ast.AugAssign
    blocked = _BLOCKED_NAMES

    for node in ast.walk(tree):
        t = type(node)
        if t is _Name:
            if node.id in blocked and isinstance(node.ctx, _Load):
                raise ValueError(f"forbidden: reference to {node.id!r} at line {node.lineno}")
        elif t is _Attribute:
            attr = node.attr
            if attr.startswith("__") and attr.endswith("__"):
                raise ValueError(f"forbidden: dunder attribute {attr!r} at line {node.lineno}")
        elif t is _Assign:
            for tgt in node.targets:
                _check_ns_attr_assign(tgt, node.lineno)
        elif t is _AugAssign:
            _check_ns_attr_assign(node.target, node.lineno)
        elif t is _Import or t is _ImportFrom:
            raise ValueError(f"forbidden: import statement at line {node.lineno}")


@lru_cache(maxsize=32)
def _validate_cached(source: str) -> None:
    """Validation result is a pure function of `source`; cache to skip parse+walk
    when the same LLM output is replayed (retries, identical regenerations)."""
    try:
        tree = ast.parse(source)
    except SyntaxError as exc:
        raise ValueError(f"strategy_code syntax error: {exc}") from exc

    _walk_and_check(tree)

    # Single scan of top-level body for the strategy() definition.
    found = False
    for n in tree.body:
        if isinstance(n, ast.AsyncFunctionDef) and n.name == "strategy":
            raise ValueError("strategy() must be a regular function, not async def")
        if isinstance(n, ast.FunctionDef) and n.name == "strategy":
            found = True
            break
    if not found:
        raise ValueError("strategy_code must define a top-level function named 'strategy'")


def validate_strategy_code(source: str) -> None:
    _validate_cached(source)

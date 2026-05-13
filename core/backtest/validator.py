import ast

_BLOCKED_CALLS = frozenset({
    "eval", "exec", "open", "__import__", "compile",
    "globals", "locals", "vars",
    "getattr", "setattr", "delattr",
    "breakpoint", "input",
})


class _SecurityVisitor(ast.NodeVisitor):
    def visit_Import(self, node: ast.Import) -> None:
        raise ValueError(f"forbidden: import statement at line {node.lineno}")

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        raise ValueError(f"forbidden: import statement at line {node.lineno}")

    def visit_Call(self, node: ast.Call) -> None:
        if isinstance(node.func, ast.Name) and node.func.id in _BLOCKED_CALLS:
            raise ValueError(f"forbidden: {node.func.id}() at line {node.lineno}")
        self.generic_visit(node)

    def visit_Attribute(self, node: ast.Attribute) -> None:
        if node.attr.startswith("__") and node.attr.endswith("__"):
            raise ValueError(f"forbidden: dunder attribute {node.attr!r} at line {node.lineno}")
        self.generic_visit(node)


def validate_strategy_code(source: str) -> None:
    try:
        tree = ast.parse(source)
    except SyntaxError as exc:
        raise ValueError(f"strategy_code syntax error: {exc}") from exc

    _SecurityVisitor().visit(tree)

    top_fns = [
        n for n in ast.walk(tree)
        if isinstance(n, ast.FunctionDef) and n.name == "strategy"
    ]
    if not top_fns:
        raise ValueError("strategy_code must define a function named 'strategy'")

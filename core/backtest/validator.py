import ast

_BLOCKED_NAMES = frozenset({
    "eval", "exec", "open", "__import__", "compile",
    "globals", "locals", "vars",
    "getattr", "setattr", "delattr",
    "breakpoint", "input",
})

_NS_NAMES = frozenset({"pd", "np", "pandas_ta"})


class _SecurityVisitor(ast.NodeVisitor):
    def visit_Import(self, node: ast.Import) -> None:
        raise ValueError(f"forbidden: import statement at line {node.lineno}")

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        raise ValueError(f"forbidden: import statement at line {node.lineno}")

    def visit_Name(self, node: ast.Name) -> None:
        # Block dangerous names wherever they appear — call sites, assignments, decorator refs, default args
        if isinstance(node.ctx, ast.Load) and node.id in _BLOCKED_NAMES:
            raise ValueError(f"forbidden: reference to {node.id!r} at line {node.lineno}")
        self.generic_visit(node)

    def visit_Attribute(self, node: ast.Attribute) -> None:
        if node.attr.startswith("__") and node.attr.endswith("__"):
            raise ValueError(f"forbidden: dunder attribute {node.attr!r} at line {node.lineno}")
        self.generic_visit(node)

    @staticmethod
    def _root_name(node: ast.expr) -> str | None:
        while isinstance(node, ast.Attribute):
            node = node.value
        return node.id if isinstance(node, ast.Name) else None

    def _check_ns_attr_assign(self, target: ast.expr, lineno: int) -> None:
        if isinstance(target, ast.Attribute) and self._root_name(target) in _NS_NAMES:
            raise ValueError(
                f"forbidden: assignment to namespace module attribute at line {lineno}"
            )

    def visit_Assign(self, node: ast.Assign) -> None:
        for tgt in node.targets:
            self._check_ns_attr_assign(tgt, node.lineno)
        self.generic_visit(node)

    def visit_AugAssign(self, node: ast.AugAssign) -> None:
        self._check_ns_attr_assign(node.target, node.lineno)
        self.generic_visit(node)


def validate_strategy_code(source: str) -> None:
    try:
        tree = ast.parse(source)
    except SyntaxError as exc:
        raise ValueError(f"strategy_code syntax error: {exc}") from exc

    _SecurityVisitor().visit(tree)

    top_fns = [
        n for n in tree.body
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == "strategy"
    ]
    if not top_fns:
        raise ValueError("strategy_code must define a top-level function named 'strategy'")
    if isinstance(top_fns[0], ast.AsyncFunctionDef):
        raise ValueError("strategy() must be a regular function, not async def")

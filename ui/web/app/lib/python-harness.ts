/**
 * python-harness.ts
 * The Python that runs a code exercise's tests inside Pyodide
 * (the private design notes, phase 4). The learner's
 * code becomes the module the tests import (`from leap import leap_year`);
 * the tests may be plain `test_*` functions with `assert` or unittest
 * classes (Exercism's), and each is reported with its name, whether it
 * passed, and its message: the assertion or the error, with its line. What
 * the code prints is captured, the last 4,000 characters of it.
 *
 * It is called as `anylearn_run(code, tests, module)` and returns a dict the
 * worker turns into JSON. A fresh module each run, so a run never sees the
 * last one's definitions.
 */
export const HARNESS = `
import sys, types, traceback, io, unittest, contextlib

def _failure(e, filename, source):
    lineno = None
    for f in reversed(traceback.extract_tb(e.__traceback__)):
        if f.filename == filename:
            lineno = f.lineno
            break
    if lineno is None and isinstance(e, SyntaxError) and e.filename == filename:
        lineno = e.lineno
    msg = "".join(traceback.format_exception_only(type(e), e)).strip().splitlines()[-1]
    if isinstance(e, AssertionError) and msg == "AssertionError" and lineno:
        lines = source.splitlines()
        if 0 < lineno <= len(lines):
            msg = "AssertionError: " + lines[lineno - 1].strip()
    if lineno:
        msg += " (line %d)" % lineno
    return msg

def anylearn_run(code, tests, module):
    out = io.StringIO()
    sys.modules.pop(module, None)
    mod = types.ModuleType(module)
    mod.__file__ = module + ".py"
    sys.modules[module] = mod
    code_file = module + ".py"
    tests_file = module + "_test.py"
    try:
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
            exec(compile(code, code_file, "exec"), mod.__dict__)
    except BaseException as e:
        return {"error": _failure(e, code_file, code), "output": out.getvalue()[-4000:], "results": []}
    ns = {"__name__": "anylearn_tests"}
    try:
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
            exec(compile(tests, tests_file, "exec"), ns)
    except BaseException as e:
        return {"error": _failure(e, tests_file, tests), "output": out.getvalue()[-4000:], "results": []}
    results = []
    for name, obj in list(ns.items()):
        if name.startswith("test_") and callable(obj) and not isinstance(obj, type):
            try:
                with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
                    obj()
                results.append({"name": name, "passed": True, "message": ""})
            except BaseException as e:
                results.append({"name": name, "passed": False, "message": _failure(e, tests_file, tests)})
    for name, obj in list(ns.items()):
        if isinstance(obj, type) and issubclass(obj, unittest.TestCase) and obj is not unittest.TestCase:
            for case in unittest.TestLoader().loadTestsFromTestCase(obj):
                r = unittest.TestResult()
                with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
                    case.run(r)
                label = ".".join(case.id().split(".")[-2:])
                problems = r.failures + r.errors
                if problems:
                    text = problems[0][1].strip().splitlines()
                    last = text[-1] if text else "failed"
                    where = next((l for l in reversed(text) if tests_file in l and "line " in l), "")
                    lineno = where.split("line ")[1].split(",")[0] if where else ""
                    results.append({"name": label, "passed": False, "message": last + (" (line %s)" % lineno if lineno else "")})
                elif r.skipped:
                    results.append({"name": label, "passed": False, "message": "skipped"})
                else:
                    results.append({"name": label, "passed": True, "message": ""})
    return {"error": "", "output": out.getvalue()[-4000:], "results": results}
`;

/** One test as the harness reported it. */
export type TestResult = { name: string; passed: boolean; message: string };

/** A run: an error before any test (syntax, an import), or the tests' results. */
export type RunResult = { error: string; output: string; results: TestResult[] };

/** "LeapTest.test_year_divisible_by_400" → "year divisible by 400". */
export function testLabel(name: string): string {
  const method = name.slice(name.lastIndexOf(".") + 1);
  return method.replace(/^test_?/, "").replace(/_/g, " ").trim() || method;
}

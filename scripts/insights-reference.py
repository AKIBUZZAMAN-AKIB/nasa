"""Reference values for src/lib/tests/trend-insights.test.ts (pymannkendall, SciPy, NumPy).\n\nRun: python3 scripts/insights-reference.py\n"""
import numpy as np, pymannkendall as mk, json
from scipy.stats import theilslopes, false_discovery_control

# deterministic data shared with the TS test
def lcg(seed):
    s = seed
    while True:
        s = (s * 16807) % 2147483647
        yield s / 2147483647

g = lcg(42)
years = list(range(1990, 2020))
monthly = {}
for y in years:
    for m in range(1, 13):
        trend = 0.05 * (y - 1990) if m in (6, 7, 8) else 0.0
        monthly[y * 100 + m] = 20 + 5 * np.sin(m / 12 * 2 * np.pi) + trend + (next(g) - 0.5) * 2
out = {'months': []}
ps = []
for m in range(1, 13):
    v = [monthly[y * 100 + m] for y in years]
    r = mk.hamed_rao_modification_test(v)
    ts = theilslopes(v, years, 0.95, method='separate')
    ps.append(r.p)
    out['months'].append({'month': m, 'slope10': ts.slope * 10, 'low10': ts.low_slope * 10, 'high10': ts.high_slope * 10, 'p': r.p})
q = false_discovery_control(ps)
for i, mm in enumerate(out['months']):
    mm['q'] = q[i]

# ridge: detrend+standardise on train years, LOO
g = lcg(7)
yrs = np.arange(2000, 2025)
n = len(yrs)
x1 = np.array([next(g) for _ in range(n)])
x2 = np.array([next(g) for _ in range(n)])
x3 = np.array([next(g) for _ in range(n)])
y = 2.0 * x1 - 1.0 * x2 + 0.1 * (yrs - 2000) + 0.3 * np.array([next(g) - 0.5 for _ in range(n)])
out['ridge_data'] = {'years': yrs.tolist(), 'y': y.tolist(), 'x1': x1.tolist(), 'x2': x2.tolist(), 'x3': x3.tolist()}

def prep(col, train):
    b = np.polyfit(yrs[train], col[train], 1)
    res = col - np.polyval(b, yrs)
    m = res[train].mean(); sd = res[train].std(ddof=1) or 1
    return (res - m) / sd

def loo(cols, lam=1.0):
    pred, act = [], []
    for o in range(n):
        tr = np.array([i for i in range(n) if i != o])
        ty = prep(y, tr)
        X = np.column_stack([prep(c, tr) for c in cols]) if cols else None
        act.append(ty[o])
        if not cols:
            pred.append(0.0); continue
        A = X[tr].T @ X[tr] + lam * np.eye(len(cols))
        beta = np.linalg.solve(A, X[tr].T @ ty[tr])
        pred.append(X[o] @ beta)
    pred, act = np.array(pred), np.array(act)
    return 1 - ((act - pred) ** 2).sum() / (act ** 2).sum()

cols = [x1, x2, x3]
r2 = loo(cols)
imp = [max(0, r2 - loo([c for k, c in enumerate(cols) if k != j])) for j in range(3)]
all_ = np.arange(n)
X = np.column_stack([prep(c, all_) for c in cols]); ty = prep(y, all_)
beta = np.linalg.solve(X.T @ X + np.eye(3), X.T @ ty)
out['ridge'] = {'r2': r2, 'importance': imp, 'beta': beta.tolist()}
import pathlib
pathlib.Path(__file__).resolve().parent.parent.joinpath("src/lib/tests/fixtures/insights-reference.json").write_text(json.dumps(out, indent=1) + "\n")

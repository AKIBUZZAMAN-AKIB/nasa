import json, numpy as np, pymannkendall as mk
from scipy import stats
rng=np.random.default_rng(42)
cases=[]
# autocorrelated trend series, with ties
for k,(n,phi,trend) in enumerate([(30,0.6,0.05),(45,0.3,-0.02),(25,0.0,0.0),(40,0.8,0.03)]):
    e=np.zeros(n)
    for i in range(1,n): e[i]=phi*e[i-1]+rng.normal()
    x=np.round(10+trend*np.arange(n)*5+e,1)  # rounding creates ties
    o=mk.original_test(x); h=mk.hamed_rao_modification_test(x); t=mk.trend_free_pre_whitening_modification_test(x)
    ts=stats.theilslopes(x, np.arange(1,n+1), 0.95, method='separate')
    rho=stats.spearmanr(x, np.arange(n)**0.5+rng.normal(size=n))
    cases.append(dict(values=x.tolist(), mk=dict(s=o.s,var=o.var_s,z=o.z,p=o.p,tau=o.Tau),
      hr=dict(var=h.var_s,z=h.z,p=h.p), tfpw=dict(s=t.s,var=t.var_s,z=t.z,p=t.p),
      sen=dict(slope=ts.slope,intercept=ts.intercept,low=ts.low_slope,high=ts.high_slope)))
ps=[0.01,0.04,0.03,0.2,0.5,0.001]
from scipy.stats import false_discovery_control
bh=false_discovery_control(ps).tolist()
a=rng.normal(size=20); b=a*0.5+rng.normal(size=20)
pr=stats.pearsonr(a,b); sr=stats.spearmanr(a,b)
print(json.dumps(dict(cases=cases,bh=dict(p=ps,q=bh),corr=dict(a=a.round(4).tolist(),b=b.round(4).tolist()))))
a2=np.array(a.round(4)); b2=np.array(b.round(4))
pr=stats.pearsonr(a2,b2); sr=stats.spearmanr(a2,b2)
import sys; print(json.dumps(dict(pearson=[pr.statistic,pr.pvalue],spearman=[sr.statistic,sr.pvalue], t=[stats.t.sf(2.1,12)*2, stats.norm.sf(1.7)*2, stats.norm.ppf(0.975), stats.norm.ppf(0.001)])), file=sys.stderr)

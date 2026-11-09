"""Regenerate static case data and existing fixed-seed scenario weights."""
import argparse
import json
from pathlib import Path
import sys
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from engine import CITIES, load_case


def browser_data():
    cases = {}
    for city in CITIES:
        case = load_case(city)
        cases[city] = {key: value.to_dict('records') if hasattr(value, 'to_dict') else
                       value.tolist() if isinstance(value, np.ndarray) else value
                       for key, value in case.items()}
        for row in cases[city]['market_curve']:
            for key, value in row.items():
                if isinstance(value, float) and not np.isfinite(value):
                    row[key] = None
    counts = {}
    for cohort in (9, 10):
        for term in (12, 24):
            draws = np.random.default_rng(20261031).integers(0, cohort, size=(100000, term // 12))
            paths, weights = np.unique(draws, axis=0, return_counts=True)
            counts[f'{cohort}_{term}'] = [{'indices': list(map(int, path)), 'count': int(weight)}
                                         for path, weight in zip(paths, weights)]
    return {'cases': cases, 'draws': counts, 'seed': 20261031, 'n_sims': 100000,
            'provenance': json.loads((ROOT / 'data/provenance.json').read_text())}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    target = ROOT / 'public/data/model.json'
    data = browser_data()
    if args.check:
        assert json.loads(target.read_text()) == data, 'Regenerate public/data/model.json'
        print('Browser reference data matches Python and the fixed seeded draws.')
    else:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(data, separators=(',', ':'), allow_nan=False))
        print('Updated public/data/model.json')

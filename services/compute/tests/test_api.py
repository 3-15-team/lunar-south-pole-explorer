import pytest
from fastapi.testclient import TestClient

from app import main


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    main.STORE.cache_dir = tmp_path_factory.mktemp("cache")
    with TestClient(main.app) as c:
        yield c


def _need(client, cap):
    if not client.get("/api/v1/info").json()["capabilities"][cap]:
        pytest.skip(f"data for {cap} not built")


def test_health_and_info(client):
    assert client.get("/health").json()["status"] == "ok"
    info = client.get("/api/v1/info").json()
    assert {"ephemeris", "dem", "regionHorizon", "capabilities"} <= set(info)
    r = client.options("/api/v1/heatmap", headers={"Origin": "http://x", "Access-Control-Request-Method": "POST"})
    assert r.headers.get("access-control-allow-origin") in ("*", "http://x")


def test_validation_errors(client):
    r = client.post("/api/v1/site-metrics", json={"lat": -10, "lon": 0, "t0": "2026-12-01T00:00:00Z",
                                                  "t1": "2026-12-02T00:00:00Z"})
    assert r.status_code == 422
    r = client.post("/api/v1/heatmap", json={"t0": "2026-12-01T00:00:00Z", "t1": "2026-12-02T00:00:00Z",
                                             "footprintM": 500})
    assert r.status_code == 422
    r = client.post("/api/v1/robustness", json={"t0": "2026-12-01T00:00:00Z", "t1": "2026-12-02T00:00:00Z",
                                                "candidates": [{"x": 1.0}]})
    assert r.status_code == 422
    assert client.get("/api/v1/heatmap/nope.txt").status_code == 404
    assert client.get("/api/v1/heatmap/0123456789abcdef01234567.png").status_code == 404


def test_site_metrics(client):
    _need(client, "siteMetrics")
    body = {"lat": -89.4389, "lon": -137.1436, "t0": "2026-12-01T00:00:00Z", "t1": "2026-12-03T00:00:00Z",
            "stepMin": 30}
    r = client.post("/api/v1/site-metrics", json=body)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["horizon"]["naz"] == 1440 and len(d["horizon"]["elevDeg"]) == 1440
    m = d["metrics"]
    assert 0.0 <= m["illumFrac"] <= 1.0 and 0.0 <= m["earthFrac"] <= 1.0
    assert m["samples"] == 96 and abs(m["dtHours"] - 0.5) < 1e-9
    assert d["now"]["sun"]["next"] is None or d["now"]["sun"]["next"]["inHours"] >= 0
    r2 = client.post("/api/v1/site-metrics", json=body)
    assert r2.headers["X-Cache"] == "hit" and r2.json()["metrics"] == m
    bad = client.post("/api/v1/site-metrics", json={**body, "t1": "2026-11-30T00:00:00Z"})
    assert bad.status_code == 400
    out = client.post("/api/v1/site-metrics", json={**body, "t0": "2040-01-01T00:00:00Z", "t1": "2040-01-02T00:00:00Z"})
    assert out.status_code == 400


def test_heatmap_and_files(client):
    _need(client, "heatmap")
    body = {"bbox": [-20000, -20000, 20000, 20000], "t0": "2026-12-01T00:00:00Z", "t1": "2026-12-08T00:00:00Z",
            "preset": "lander", "footprintM": 50}
    r = client.post("/api/v1/heatmap", json=body)
    assert r.status_code == 200, r.text
    d = r.json()
    meta = d["meta"]
    assert meta["width"] > 10 and meta["height"] > 10 and meta["legend"]["colormap"] == "cividis"
    assert len(meta["candidates"]) <= 10
    for c in meta["candidates"]:
        assert -20000 - 300 <= c["x"] <= 20000 + 300 and 0 <= c["score"] <= 1
    png = client.get(d["png"])
    assert png.status_code == 200 and png.content[:4] == b"\x89PNG"
    assert client.get(d["json"]).json()["id"] == d["id"]
    assert client.post("/api/v1/heatmap", json=body).headers["X-Cache"] == "hit"


def test_robustness(client):
    _need(client, "robustness")
    body = {"t0": "2026-12-01T00:00:00Z", "t1": "2026-12-08T00:00:00Z", "preset": "base", "footprintM": 40,
            "candidates": [{"lat": -89.4389, "lon": -137.1436}, {"lat": -89.7804, "lon": -156.197},
                           {"lat": -88.6639, "lon": -68.388}], "n": 50, "k": 2}
    r = client.post("/api/v1/robustness", json=body)
    assert r.status_code == 200, r.text
    d = r.json()
    assert len(d["candidates"]) == 3
    tot = sum(c["rankStability"] for c in d["candidates"] if c["rankStability"] is not None)
    assert abs(tot - 2.0) < 1e-6 or any(c["excluded"] for c in d["candidates"])

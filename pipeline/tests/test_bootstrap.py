import hashlib
import json

from pipeline import bootstrap


def test_complete_rejects_missing_and_corrupt_tiles(tmp_path, monkeypatch):
    monkeypatch.setattr(bootstrap, "DATA", tmp_path)
    monkeypatch.setattr(bootstrap, "WEB", tmp_path / "web")
    monkeypatch.setattr(bootstrap, "MANIFEST", tmp_path / "manifest.json")
    assert not bootstrap.complete()
    web = tmp_path / "web"
    (web / "dem/0/0").mkdir(parents=True)
    (web / "ephem").mkdir()
    tile = web / "dem/0/0/0.bin"
    tile.write_bytes(b"real-format-payload")
    (web / "ephem/index.json").write_text("{}")
    listing = web / "dem/SHA256SUMS"
    listing.write_text(f"{hashlib.sha256(tile.read_bytes()).hexdigest()}  0/0/0.bin\n")
    product = {"path": "web/dem/SHA256SUMS", "sha256": hashlib.sha256(listing.read_bytes()).hexdigest(),
               "kind": "tree"}
    products = {name: product for name in ("dem", "ephem", "sites", "psr", "heatmaps", "micro_relief", "outer_dem")}
    (tmp_path / "manifest.json").write_text(json.dumps({"products": products}))
    assert bootstrap.complete()
    tile.write_bytes(b"corrupt")
    assert not bootstrap.complete()
    tile.unlink()
    assert not bootstrap.complete()


def test_fingerprint_changes_with_data_parameters():
    assert bootstrap.fingerprint(0, 1920) != bootstrap.fingerprint(1, 1920)
    assert bootstrap.fingerprint(0, 1920) != bootstrap.fingerprint(0, 240)

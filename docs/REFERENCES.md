# REFERENCES — every external resource used (data, code, papers)

## Data (NASA open data; US public domain unless noted)

| resource | URL | use |
|---|---|---|
| LOLA polar DEMs 80°S–90°S, 80 m & 40 m (+ error maps), Barker et al. 2023 | https://pgda.gsfc.nasa.gov/products/90 | terrain tiles z0–z6, horizon, slope, uncertainty |
| LOLA 5 m site DEMs (Site01/04/06/07/11/20v2/23, DM2, Haworth), Barker et al. 2021 | https://pgda.gsfc.nasa.gov/products/78 | hero sites z7–z9, panorama |
| LOLA permanently shadowed regions > 1 km² (shapefile) | https://pgda.gsfc.nasa.gov/products/90 | PSR overlay |
| Mazarico et al. average Sun / Earth visibility maps (REFERENCE ONLY) | https://pgda.gsfc.nasa.gov/products/69 | validation (`docs/VALIDATION.md`) |
| NAIF SPICE generic kernels: `naif0012.tls`, `pck00011.tpc`, `de440s.bsp`, `moon_pa_de440_200625.bpc`, `moon_de440_250416.tf` | https://naif.jpl.nasa.gov/pub/naif/generic_kernels/ | Sun/Earth ephemerides in MOON_ME |
| JPL Horizons API | https://ssd-api.jpl.nasa.gov/doc/horizons.html | ephemeris validation (offline job only) |
| NASA SVS south-pole illumination visualizations | https://svs.gsfc.nasa.gov/4930/ | visual sanity check of the shadow layer |
| Teammate prototype (Babylon.js LOLA Site04 viewer, repo root `/dist`) | team repository | ideas only (ADR-012), no code imported |

- LOLA global gridded DEM `ldem_16` (16 px/deg), LRO LOLA GDR, NASA PDS Geosciences Node,
  https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/ —
  context Moon outside 80°S on the map (Smith, D. E., et al. (2010). The Lunar Orbiter Laser Altimeter
  investigation on the Lunar Reconnaissance Orbiter mission. *Space Sci. Rev.* 150, 209–241).

## Papers

- Barker, M. K., et al. (2021). Improved LOLA elevation maps for south pole landing sites: error estimates and their impact on illumination conditions. *Planetary and Space Science* 203, 105119. https://doi.org/10.1016/j.pss.2020.105119
- Barker, M. K., et al. (2023). A new view of the lunar south pole from the Lunar Orbiter Laser Altimeter (LOLA). *Planetary Science Journal* 4, 183. https://doi.org/10.3847/PSJ/acf3e1
- Mazarico, E., et al. (2011). Illumination conditions of the lunar polar regions using LOLA topography. *Icarus* 211, 1066–1081. https://doi.org/10.1016/j.icarus.2010.10.030
- Park, R. S., et al. (2021). The JPL Planetary and Lunar Ephemerides DE440 and DE441. *AJ* 161, 105. https://doi.org/10.3847/1538-3881/abd414
- Acton, C. H. (1996). Ancillary data services of NASA's Navigation and Ancillary Information Facility. *Planetary and Space Science* 44, 65–70 (SPICE).

## Open-source software

| component | licence | URL |
|---|---|---|
| Preact, @preact/signals | MIT | https://preactjs.com |
| OpenLayers | BSD-2-Clause | https://openlayers.org |
| three.js | MIT | https://threejs.org |
| Vite, Vitest | MIT | https://vite.dev |
| TypeScript | Apache-2.0 | https://www.typescriptlang.org |
| SpiceyPy (+ CSPICE) | MIT (SpiceyPy); CSPICE: NAIF rules (free) | https://github.com/AndrewAnnex/SpiceyPy |
| NumPy | BSD-3-Clause | https://numpy.org |
| Numba | BSD-2-Clause | https://numba.pydata.org |
| rasterio (+ GDAL) | BSD-3-Clause (rasterio), MIT/X (GDAL) | https://rasterio.readthedocs.io |
| pyshp | MIT | https://github.com/GeospatialPython/pyshp |
| SciPy, llvmlite | BSD-3 / BSD-2 | https://scipy.org |
| Shapely (+ GEOS) | BSD-3 (GEOS: LGPL-2.1) | https://shapely.readthedocs.io |
| Pillow | MIT-CMU (HPND) | https://python-pillow.org |
| FastAPI, Starlette, Pydantic, Uvicorn | MIT / BSD-3-Clause | https://fastapi.tiangolo.com |
| pytest, ruff, httpx | MIT | — |
| nginx (container image) | BSD-2-Clause | https://nginx.org |
| python:3.12-slim, node:22-alpine, nginx:1.27-alpine images | PSF / MIT / BSD-2 (+ Debian/Alpine packages) | Docker Hub |
| Inter / system fonts | system fonts only (no web fonts loaded) | — |
| Cividis colour map (approximation) | Nuñez, Anderton & Renslow 2018, PLoS ONE 13(7) | https://doi.org/10.1371/journal.pone.0199239 |

## Synthetic content

- Regolith micro-texture (map and panorama), the warm-up Moon surface, the star field and the
  Earth disc pattern are **procedural** (generated in shaders), labelled as such in the UI.
- Panorama sub-DEM micro-relief (`data/web/micro`, `pipeline/jobs/micro_relief.py`) is **statistical**:
  heights drawn from published crater/boulder size–frequency distributions (no imagery, no ML), shaded
  live with the real Sun; labelled "synthetic sub-DEM relief" in the UI. Parameter sources:
  - Pajola, M., et al. (2019). Abundance and size-frequency distributions of boulders in Linné crater's
    ejecta (Moon). *Planetary and Space Science* 165, 99–109. https://arxiv.org/abs/1812.00590
  - Bart, G. D., & Melosh, H. J. (2010). Distributions of boulders ejected from lunar craters. *Icarus* 209,
    337–357. https://doi.org/10.1016/j.icarus.2010.05.023
  - Small-crater equilibrium N(>D) ∝ D⁻² (Gault, 1970; Melosh, *Impact Cratering*, 1989).
- No copyrighted images or music are used.

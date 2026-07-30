# HugMesh user-ui — developer Makefile.
#
# `make pentest` runs the SAME OWASP pen-test surface the CI `pentest` stage runs
# (see .gitlab-ci.yml + the centralized generator stage at
# HugMesh/hugmesh-generator:/tests/pentest/ci/pentest-stage.gitlab-ci.yml),
# but locally, so a dev can self-scan before pushing. It is self-contained and
# NEVER hard-fails when a target URL or the tooling is absent — it degrades to a
# note so `make pentest` is always safe to run.
#
#   SCA  : dependency audit over THIS repo (Angular: `npm audit`, mirroring the CI
#          SCA job; CI additionally runs OWASP dependency-check in the
#          owasp/dependency-check image — run that here too if Docker is present).
#   DAST : delegates to the generator harness (tests/pentest/run-pentest.sh) against
#          $(DAST_TARGET_URL) when set; otherwise prints how to run it and exits 0.

SHELL := /bin/bash

# Where the centralized pen-test harness lives. Defaults to a sibling checkout of
# the generator repo; override with PENTEST_HARNESS_DIR=... if vendored/elsewhere.
PENTEST_HARNESS_DIR ?= $(abspath ../hugmesh-generator/tests/pentest)
DEPCHECK_IMAGE      ?= owasp/dependency-check:latest
SCA_FAIL_CVSS       ?= 9

.PHONY: pentest pentest-sca pentest-dast

## pentest: run the local SCA self-scan + (when $$DAST_TARGET_URL is set) the DAST harness
pentest: pentest-sca pentest-dast
	@echo "[pentest] done."

## pentest-sca: Software Composition Analysis over this repo (mirrors the CI sca job)
pentest-sca:
	@echo "[pentest:sca] npm audit (Angular dependency SCA, mirrors CI npm-audit gate) ..."
	@if command -v npm >/dev/null 2>&1; then \
		npm audit --audit-level=high || echo "[pentest:sca] npm audit reported findings (non-blocking locally; CI gates this)."; \
	else \
		echo "[pentest:sca] npm not found — skipping npm audit. Install Node to self-scan."; \
	fi
	@echo "[pentest:sca] OWASP dependency-check (full CI-parity SCA) ..."
	@if command -v docker >/dev/null 2>&1; then \
		mkdir -p reports/sca .nvd-cache; \
		docker run --rm -v "$(CURDIR):/src:ro" -v "$(CURDIR)/reports/sca:/report" -v "$(CURDIR)/.nvd-cache:/usr/share/dependency-check/data" \
			--entrypoint "" $(DEPCHECK_IMAGE) \
			/usr/share/dependency-check/bin/dependency-check.sh \
			--project "$(notdir $(CURDIR))" --scan /src --out /report \
			--data /usr/share/dependency-check/data --failOnCVSS $(SCA_FAIL_CVSS) \
			--enableExperimental --format HTML --format JSON \
			|| echo "[pentest:sca] dependency-check reported findings >= CVSS $(SCA_FAIL_CVSS) (see reports/sca/)."; \
	else \
		echo "[pentest:sca] docker not found — skipping OWASP dependency-check. CI runs it in $(DEPCHECK_IMAGE)."; \
	fi

## pentest-dast: delegate to the full generator DAST harness against $$DAST_TARGET_URL
pentest-dast:
	@if [ -z "$(DAST_TARGET_URL)" ]; then \
		echo "[pentest:dast] DAST_TARGET_URL not set — skipping DAST (CI spins an env-test-build and runs the full probes+nuclei harness)."; \
		echo "[pentest:dast] To run locally against a target:"; \
		echo "[pentest:dast]   make pentest DAST_TARGET_URL=https://your-test-gateway"; \
	elif [ -x "$(PENTEST_HARNESS_DIR)/run-pentest.sh" ]; then \
		echo "[pentest:dast] running the centralized harness against $(DAST_TARGET_URL) ..."; \
		ZAP_TARGET="$(DAST_TARGET_URL)" bash "$(PENTEST_HARNESS_DIR)/run-pentest.sh" --env compose --scan baseline --pipeline main \
			|| echo "[pentest:dast] harness reported findings (non-blocking locally)."; \
	else \
		echo "[pentest:dast] harness not found at $(PENTEST_HARNESS_DIR)/run-pentest.sh."; \
		echo "[pentest:dast] Clone it, then re-run, e.g.:"; \
		echo "[pentest:dast]   git clone https://github.com/hugmesh-net/hugmesh-generator /tmp/hugmesh-generator"; \
		echo "[pentest:dast]   make pentest DAST_TARGET_URL=$(DAST_TARGET_URL) PENTEST_HARNESS_DIR=/tmp/hugmesh-generator/tests/pentest"; \
	fi

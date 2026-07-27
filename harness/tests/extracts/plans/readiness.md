# Tests hub plans readiness

**Who:** `/testcase`, `/grill-testcase`  
**Not:** FE `/test` Playwright gen

## Gate

1. [ ] Design `W-*` / rules / acceptance tồn tại trên **docs hub** (SSOT)
2. [ ] `surface` → `CMP-*` (module) → `SC-*` (GWT + examples + coverage_plan)
3. [ ] Mỗi `TC-*` dùng `coverage[]` (không `type`); refs + bridge FE đủ gen
4. [ ] `registries/tests-index.json` cập nhật
5. [ ] `pnpm check:plans` · `pnpm cases:render` (MD member VI)
6. [ ] Grill: không còn `spec_hole` mở; coverage_gap đã xử lý hoặc backlog có chủ
7. [ ] Handoff FE chỉ sau grill-testcase OK

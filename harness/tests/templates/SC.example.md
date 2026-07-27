---
id: SC-EXAMPLE
module: CMP-01-auth
surface: admin
screen: W-AD-AUTH-001
rules:
  - RUL-00-example
coverage_plan:
  - happy
  - validation
---

# SC-EXAMPLE — _Tên scenario tiếng Việt_

Scenario dưới **CMP-*** · capability **CAP-***.  
Rule chi tiết trên **docs hub** (chỉ cite id).

| | |
|--|--|
| **Scenario** | `SC-EXAMPLE` |
| **Module** | `CMP-01-auth` |
| **Surface** | `admin` |
| **Screen** | `W-AD-AUTH-001` |

## Vì sao quan trọng

_1–3 câu cho member: rủi ro / giá trị nghiệp vụ._

## Hành vi (Given / When / Then)

**Given** _điều kiện_  
**When** _hành động_  
**Then** _kết quả_

## Ví dụ (Specification by Example)

| # | Input… | Kết quả mong đợi | Automation |
|---|--------|------------------|------------|
| EX-01 | … | … | `TC-EXAMPLE-VALID` |

## Bao phủ (risk)

| Facet | Có? | Ghi chú |
|-------|-----|---------|
| happy | EX-01 | |
| validation | chưa | backlog |

```mermaid
stateDiagram-v2
  [*] --> Start
  Start --> Done: happy
```

## Cases

| ID | coverage | Folder |
|----|----------|--------|
| TC-EXAMPLE-VALID | happy | `cases/W-*/` |

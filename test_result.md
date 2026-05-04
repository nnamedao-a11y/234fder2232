#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# (preserved as-is from upstream — see git history for the original protocol)

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================


user_problem_statement: |
  Continue the in-progress task on payment + authorization logic for the BIBI Cars CRM.
  Goal: connect the four roles (master_admin, team_lead, manager, client) into a single
  flow:

      Manager creates multi-line invoice  ─►  Client pays
      ─►  System auto-creates Order with workflow steps
      ─►  Manager / Team Lead works the order
      ─►  Client sees real-time status in the cabinet

  Concrete deliverables (the previous run had only stubs / partial UI):
    1. Backend services catalog (master_admin only) + manager multi-line invoice
    2. Order auto-creation on payment success (Stripe webhook AND manual mark-paid)
    3. Order endpoints — manager / team-lead / customer views + step updates + notes
    4. Frontend: /admin/services, /manager/invoices (multi-line), /manager/orders,
       /team/orders, customer cabinet "Мої замовлення" using real data.
    5. End-to-end test of the full flow.

backend:
  - task: "Master-admin services catalog (CRUD + public read)"
    implemented: true
    working: true
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: true
        agent: "main"
        comment: "GET /api/services (public), GET/POST/PATCH/DELETE /api/admin/services (master_admin)."

  - task: "Manager multi-line invoice creation"
    implemented: true
    working: true
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: true
        agent: "main"
        comment: "POST /api/manager/invoices accepts items[]={service_id|name,price,qty}, normalises, totals, persists. GET /api/manager/invoices/my returns own invoices."

  - task: "Invoice lifecycle: send / cancel / mark-paid (auto-creates order)"
    implemented: true
    working: true
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: true
        agent: "main"
        comment: "PATCH /api/invoices/{id}/send|cancel|mark-paid. mark-paid is idempotent and triggers _create_order_from_invoice — same path as Stripe webhook."

  - task: "Order auto-creation on payment success (Stripe webhook hook)"
    implemented: true
    working: true
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: true
        agent: "main"
        comment: "_record_payment_from_stripe → invoice paid → _create_order_from_invoice. Idempotent by invoiceId."

  - task: "Order views & step controls (manager/team/customer)"
    implemented: true
    working: true
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: true
        agent: "main"
        comment: "GET /api/manager/orders, GET /api/team/orders, GET /api/customer-cabinet/{id}/orders, GET/PATCH /api/orders/{id}, PATCH /api/orders/{id}/steps/{step_id}, POST /api/orders/{id}/notes. Recalc rules: any in_progress|done → in_progress; all done → completed."

frontend:
  - task: "/admin/services — catalog management page"
    implemented: true
    working: "NA"
    file: "frontend/src/pages/admin/AdminServicesPage.jsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "List + create / edit modal with workflow editor, soft-delete. Wired in App.js as /admin/services."

  - task: "/manager/invoices — multi-line invoice builder"
    implemented: true
    working: "NA"
    file: "frontend/src/pages/ManagerInvoicesPage.jsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "Refactored to fetch /api/services, multi-line builder with service picker overlay, custom lines, qty/price edit, total. Detail drawer with send/cancel/mark-paid + linked order preview."

  - task: "/manager/orders — workflow management page"
    implemented: true
    working: "NA"
    file: "frontend/src/pages/manager/ManagerOrdersPage.jsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "List + detail with progress bar, step controls (pending → in_progress → done), notes."

  - task: "/team/orders — team-lead overview"
    implemented: true
    working: "NA"
    file: "frontend/src/pages/team/TeamOrdersPage.jsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "Aggregates orders from all managers, filters by status / manager, KPI cards."

  - task: "Customer cabinet Orders tab — real progress"
    implemented: true
    working: "NA"
    file: "frontend/src/components/cabinet/CustomerOrders.jsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "Replaces previous mock. Polls every 30s. Groups steps by service, shows live progress + notes."

metadata:
  created_by: "main_agent"
  version: "1.0"
  test_sequence: 1
  run_ui: true

test_plan:
  current_focus:
    - "Master-admin services catalog (CRUD + public read)"
    - "Manager multi-line invoice creation"
    - "Invoice lifecycle: send / cancel / mark-paid (auto-creates order)"
    - "Order views & step controls (manager/team/customer)"
    - "/admin/services — catalog management page"
    - "/manager/invoices — multi-line invoice builder"
    - "/manager/orders — workflow management page"
    - "/team/orders — team-lead overview"
    - "Customer cabinet Orders tab — real progress"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
  - agent: "main"
    message: |
      Re-deployed BIBI Cars CRM from the GitHub repo and finished the previously
      in-progress payment+orders feature.

      Backend now has:
        services catalog (master_admin) ─► invoice items[] (manager) ─► payment
        (Stripe webhook OR manual mark-paid) ─► order auto-created ─► step
        updates ─► all four cabinets (admin / team / manager / customer).

      Confirmed via /tmp/e2e_payment_flow.py — 12/12 checks passed.

      Frontend: AdminServicesPage, ManagerInvoicesPage (multi-line builder +
      service picker + detail drawer with linked order), ManagerOrdersPage,
      TeamOrdersPage, CustomerOrders — all wired into App.js routes.

      Auth: master admin = admin@bibi.cars / Jp3FS_7ZuE2bhHp7rFkJm9B9T_TeiHxu
      (re-seeded on every backend startup; standard /api/auth/login Bearer flow).

      Please test the FULL flow end-to-end against the preview URL:

        1. login as master admin
        2. /admin/services  →  create one service with workflow steps
        3. /manager/invoices  →  create multi-line invoice (catalog + custom)
        4. open invoice  →  "Підтвердити оплату" (mark-paid)
        5. /manager/orders   →  see new order, advance one step
        6. /team/orders     →  same order visible
        7. customer-cabinet (use the invoice's customerId)  →  status reflects step

      Skip anything camera/voice/drag-drop — none of that is involved.

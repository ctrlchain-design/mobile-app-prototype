/*
 * app.js — CtrlChain Driver onboarding prototype.
 * Vanilla JS, hash-routed, single mocked state object. No build step,
 * no dependencies — deployable as-is to GitHub Pages.
 *
 * Phase 1 scope: all four New Driver / returning-driver entry paths
 * (Self-Registration, Portal-Based magic link, Returning Driver,
 * Guest/One-Off) plus a shared Dashboard, per the FigJam
 * "CCA Driver App — Onboarding & Pickup Journey" board. Milestone
 * confirmation, exceptions, and communication are Phase 2.
 */

const MOCK_PLANNER_RECORD = {
  firstName: 'Alex',
  lastName: 'Turner',
  carrier: 'Meridian Freight Ltd',
  phone: '+44 7700 900123',
};

const MOCK_RETURNING_DRIVER = { firstName: 'Jordan', lastName: 'Reyes', carrier: 'Meridian Freight Ltd', phone: '+44 7700 900456' };

/* Milestone label sets per stop type, matching the target list in the vault's
   product-foundation.md (arrived -> loading/unloading -> departed), each with
   its own timestamp, source (automated/manual), and confirm state. This mirrors
   CtrlChain's real trip model (05-projects/carrier-tms/trip-details.md): a trip
   is a sequence of stops, and a stop can carry one or more customer orders. */
/* The real, logical lifecycle of a stop — a live ETA leads into it, then
   geofence-detectable arrival/departure bookend a manual load/unload action,
   with POD its own gated step on delivery stops. `kind` drives both how a
   stage is rendered and how it can complete:
     'eta'    — informational only, never confirmable, always visible once set.
     'auto'   — geofence-detectable; proposed automatically, driver confirms.
     'manual' — only the driver knows this happened; driver marks it done.
     'pod'    — gated on the prior stage; completes itself once every order at
                this stop has a POD uploaded (see submitPod()).
     'pallet-exchange' — pickup-only, conditional (only present on stops that
                actually need one — per uat-findings.md, "if pallet exchange
                isn't required, don't ask at all") and logged **per customer
                order**, not once for the whole stop (kickoff-pack.md line
                40: "Log pallet exchange per customer order") — same gating
                shape as 'pod': completes itself once every order at this
                stop has a driver-entered count (see submitPalletCount()).
                No automated extraction is assumed here: Corax's OCR-based
                count extraction is confirmed working today, but only for
                NewCold — not something CtrlChain can assume for an
                arbitrary broker-model shipper (see
                keep-brand-artifacts-separate). The driver always enters the
                actual count by hand, per order; a count that doesn't match
                what was expected for that order is flagged as a structured
                exception for ops to review, not resolved silently.
   Status values: 'eta' (informational) | 'pending' (blocked, future) |
   'ready' (manual/pod/pallet-exchange stage unlocked, awaiting the driver)
   | 'proposed' (auto stage awaiting confirm) | 'confirmed' (done).
   completeMilestone() advances a stop
   to its next stage and, on a stop's last stage, hands the trip's
   activeStopId to the next stop — so the whole trip progresses, not just one
   stop in isolation. */
function pickupStages(etaTime, palletDock) {
  const stages = [
    { id: 'eta', label: 'Pickup ETA', kind: 'eta', status: 'eta', source: null, timestamp: etaTime },
    { id: 'arrived', label: 'Arrived at pickup', kind: 'auto', status: 'pending', source: null, timestamp: null },
  ];
  if (palletDock) {
    stages.push({
      id: 'pallet-exchange', label: 'Pallet exchange — ' + palletDock, kind: 'pallet-exchange',
      status: 'pending', source: null, timestamp: null,
    });
  }
  stages.push(
    { id: 'loaded', label: 'Cargo loaded', kind: 'manual', status: 'pending', source: null, timestamp: null },
    { id: 'departed', label: 'Departed pickup', kind: 'auto', status: 'pending', source: null, timestamp: null }
  );
  return stages;
}
function deliveryStages(etaTime) {
  return [
    { id: 'eta', label: 'Delivery ETA', kind: 'eta', status: 'eta', source: null, timestamp: etaTime },
    { id: 'arrived', label: 'Arrived at delivery', kind: 'auto', status: 'pending', source: null, timestamp: null },
    { id: 'unloaded', label: 'Cargo unloaded', kind: 'manual', status: 'pending', source: null, timestamp: null },
    { id: 'pod', label: 'POD uploaded', kind: 'pod', status: 'pending', source: null, timestamp: null },
    { id: 'departed', label: 'Departed delivery', kind: 'auto', status: 'pending', source: null, timestamp: null },
  ];
}

/* The one trip a driver is actually transporting right now. Modelled as an array
   (see activeTripSection()) so the UI scales to more than one — Samuel's call,
   even though V1 only ever has a single truck / single active trip in practice.
   TRIP2026-000123 tells one coherent story, and — per the kickoff doc, V1
   scope is the *pickup* flow specifically — the default active stop is the
   pickup, mid-flight (arrived, awaiting confirm), not a later delivery stop:
   that's the moment V1's milestone confirmation/geofence-validation work is
   actually about. Everything downstream of it is genuinely still blocked. */
const MOCK_ACTIVE_TRIPS = [
  {
    id: 'TRIP2026-000123',
    activeStopId: 'STOP-1',
    // Consolidated, 2 orders — both are loaded at the one pickup and both are
    // delivered at the one delivery, so the same two orders appear at both
    // stops (previously PO-33211 only appeared at delivery, as if it had never
    // been picked up — fixed here).
    stops: [
      {
        id: 'STOP-1', type: 'pickup', location: 'Meridian Distribution Centre, Coventry', appointment: 'Today, 08:00',
        // expectedPallets/actualPallets/palletConfirmed/palletMismatch are
        // pallet-exchange fields, logged per customer order (kickoff-pack.md
        // line 40) — same shape as podUploaded on the delivery-side orders
        // below. No pre-filled actualPallets: no automated extraction exists
        // to seed it with, the driver always types it in themselves.
        orders: [
          { id: 'ORD-8841937', ref: 'PO-33210', expectedPallets: 7, actualPallets: null, palletConfirmed: false, palletMismatch: false },
          { id: 'ORD-8841938', ref: 'PO-33211', expectedPallets: 5, actualPallets: null, palletConfirmed: false, palletMismatch: false },
        ],
        milestones: (() => {
          // Pallet exchange required at this shipper — exchange dock is a
          // per-warehouse constant per uat-findings.md, not per-trip.
          const s = pickupStages('07:55', 'Dock 018');
          // Geofence fired 2 minutes early against the calculated ETA — a real
          // case for the timestamp-edit feature, not just a round number.
          s[1].status = 'proposed'; s[1].source = 'automated'; s[1].timestamp = '08:02';
          return s;
        })(),
        exceptions: [],
      },
      {
        id: 'STOP-2', type: 'delivery', location: 'Aldi RDC, Bristol', appointment: 'Today, 14:30',
        orders: [
          { id: 'ORD-8841937', ref: 'PO-33210', podUploaded: false },
          { id: 'ORD-8841938', ref: 'PO-33211', podUploaded: false },
        ],
        milestones: deliveryStages('14:30'),
        exceptions: [],
      },
    ],
  },
];

/* Scheduled trips not yet underway — shown collapsed in their own section,
   per Samuel's call that upcoming/scheduled trips get a separate list, not
   a timeline (nothing to act on until they become the active trip). */
const MOCK_UPCOMING_TRIPS = [
  { id: 'TRIP2026-000124', pickup: 'Heathrow Cargo Terminal', dropoff: 'Southampton Docks', status: 'Scheduled', badge: 'warning', eta: 'Tomorrow, 08:00' },
];

/* Read-only — completed trips aren't mutated in this prototype, so these don't
   need a state clone the way scheduledTrips (driver can add to it) does. */
const MOCK_TRIP_HISTORY = [
  { id: 'TRIP2026-000098', pickup: 'Dover Freight Village', dropoff: 'Meridian Distribution Centre, Coventry', status: 'Completed', badge: 'success', eta: 'Yesterday, 18:45' },
];

const MOCK_GUEST_TRIP = {
  id: 'TRIP2026-000142',
  activeStopId: 'STOP-G1',
  stops: [
    {
      id: 'STOP-G1', type: 'pickup', location: 'Heathrow Cargo Terminal', appointment: 'Today, 13:00',
      orders: [{ id: 'ORD-9001', ref: 'GT-142' }],
      milestones: (() => {
        const s = pickupStages('12:55');
        s[1].status = 'proposed'; s[1].source = 'automated'; s[1].timestamp = '13:04';
        return s;
      })(),
      exceptions: [],
    },
    {
      id: 'STOP-G2', type: 'delivery', location: 'Southampton Docks', appointment: 'Today, 16:00',
      orders: [{ id: 'ORD-9001', ref: 'GT-142', podUploaded: false }],
      milestones: deliveryStages('16:00'),
      exceptions: [],
    },
  ],
};

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

/* 8 digits, not 6 — backend preference, harder to brute-force than a 6-digit code. */
const MOCK_ACTIVATION_CODE = '48213976';

/* Sent by email/SMS the moment self-registration completes, alongside the
   confirmation that ops now has the driver's details to review — this is
   the one concrete thing a driver can act on while waiting: quote it if
   they contact their carrier's back office about a delay, rather than
   having no way to reference the request at all. */
const MOCK_REGISTRATION_REF = 'REG2026-48213';

/* Mocked native OAuth account-chooser sheets — one per social provider, styled after
   each provider's real embedded sign-in UI rather than CCA's own visual system. */
const OAUTH_PROVIDERS = {
  google: {
    label: 'Google', domain: 'accounts.google.com', logo: 'assets/social-google.svg',
    share: 'name, email address, language preference, and profile picture',
    accounts: [
      { name: 'Jordan Reyes', email: 'jordan.reyes@gmail.com', initial: 'J', color: '#7c5cbf', signedOut: true },
      { name: 'Alex Turner', email: 'alex.turner@gmail.com', initial: 'A', color: '#3f7fbf' },
    ],
  },
  apple: {
    label: 'Apple', domain: 'appleid.apple.com', logo: 'assets/social-apple.svg',
    share: 'name and email address',
    accounts: [
      { name: 'Jordan Reyes', email: 'jordan.reyes@icloud.com', initial: 'J', color: '#5a5a5f' },
    ],
  },
};

/* Returns whichever mock driver record the currently-displayed portal-flow screen should show —
   the original portal onboarding record, or the returning driver's own record when these same
   screens are being reused for an account-reactivation request. */
function currentPortalRecord() {
  return state.reactivating ? MOCK_RETURNING_DRIVER : MOCK_PLANNER_RECORD;
}

/* Route metadata: { flow, step, total } for progress display. null = terminal/no-flow screen. */
const ROUTE_META = {
  'self-reg-welcome': null,
  'self-reg-social-google': null,
  'self-reg-social-apple': null,
  'self-reg-signup': { flow: 'self-reg', step: 1, total: 6 },
  'self-reg-otp': { flow: 'self-reg', step: 2, total: 6 },
  'self-reg-password': { flow: 'self-reg', step: 3, total: 6 },
  'self-reg-details': { flow: 'self-reg', step: 4, total: 6 },
  'self-reg-gdpr': { flow: 'self-reg', step: 5, total: 6 },
  'self-reg-pin': { flow: 'self-reg', step: 6, total: 6 },
  // portal-sms and portal-install both happen before the driver has the app
  // open at all (a text message, then either the App Store or manually
  // switching to an already-installed app) — neither is a real numbered step
  // in CtrlChain's own onboarding, so neither gets progress-bar chrome.
  'portal-sms': null,
  'portal-install': null,
  'portal-code': { flow: 'portal', step: 1, total: 4 },
  'portal-confirm': { flow: 'portal', step: 2, total: 4 },
  'portal-pin': { flow: 'portal', step: 3, total: 4 },
  'portal-gdpr': { flow: 'portal', step: 4, total: 4 },
  'returning-entry': { flow: 'returning', step: 1, total: 2 },
  'returning-pin': { flow: 'returning', step: 2, total: 2 },
  'returning-password': { flow: 'returning', step: 2, total: 2 },
  'returning-request-activation': { flow: 'returning', step: 2, total: 3 },
  'returning-activation-sent': { flow: 'returning', step: 3, total: 3 },
  'guest-sms': { flow: 'guest', step: 1, total: 2 },
  'guest-trust': { flow: 'guest', step: 2, total: 2 },
  'location-priming': null,
  'location-os-prompt-1': null,
  'location-os-prompt-2': null,
  'location-denied': null,
  'dashboard': null,
  'nav-trips': null,
  'nav-notifications': null,
  'nav-chats': null,
  'nav-profile': null,
};

const FLOW_FIRST_ROUTE = { 'self-reg': 'self-reg-welcome', 'portal': 'portal-sms', 'returning': 'returning-entry', 'guest': 'guest-sms' };
const FLOW_LABELS = { 'self-reg': 'Self-Registration', 'portal': 'Portal-Based (Magic Link)', 'returning': 'Returning Driver', 'guest': 'Guest / One-Off' };

const TITLES = {
  'self-reg-welcome': '',
  'self-reg-signup': 'Create your account',
  'self-reg-otp': 'Verify your number',
  'self-reg-password': 'Set a password',
  'self-reg-details': 'Your details',
  'self-reg-gdpr': 'Terms & privacy',
  'self-reg-pin': 'Secure your account',
  'portal-sms': "You've been invited",
  'portal-install': 'Get the app',
  'portal-code': 'Enter your code',
  'portal-confirm': 'Confirm your details',
  'portal-pin': 'Secure your account',
  'portal-gdpr': 'Terms & privacy',
  'returning-entry': 'Welcome back',
  'returning-pin': 'Quick sign-in',
  'returning-password': 'Session expired',
  'returning-request-activation': 'Reactivate your account',
  'returning-activation-sent': 'Enter code',
  'guest-sms': 'Guest access',
  'guest-trust': "You've been added",
  'dashboard': 'Dashboard',
  'nav-trips': 'My Trips',
  'nav-notifications': 'Notifications',
  'nav-chats': 'Chats',
  'nav-profile': 'Profile',
};

function freshState() {
  return {
    activeFlow: null,
    loginMethod: 'phone',
    phone: '',
    email: '',
    otp: '',
    password: '',
    firstName: '',
    lastName: '',
    gdprAccepted: false,
    portalCode: '',
    pin: '',
    pinTarget: 'dashboard',
    portalGdprAccepted: false,
    dashboardMode: 'full', // 'locked' | 'full' | 'guest'
    returningOrigin: 'self-reg', // 'self-reg' | 'portal' — which onboarding path this returning driver used
    returningEmail: '',
    returningPassword: '',
    reactivationContact: '',
    reactivationCode: '',
    reactivating: false,
    locationPermission: null, // null | 'always' | 'while-using' | 'once' | 'denied'

    // Mutable copies — the driver confirms milestones, edits timestamps, and
    // uploads PODs against these, never against the MOCK_* constants directly.
    activeTrips: deepClone(MOCK_ACTIVE_TRIPS),
    guestTrip: deepClone(MOCK_GUEST_TRIP),
    scheduledTrips: deepClone(MOCK_UPCOMING_TRIPS), // driver can add to this via "Add a trip"

    // Dashboard UI-only state (expand/collapse, open modals) — not part of the
    // trip data itself, reset on every restart along with everything else.
    stopExpandOverride: {}, // stopId/tripId -> boolean, overrides the default (active stop open)
    editingMilestone: null, // { stopId, milestoneId } | null — which timestamp is mid-edit
    podSheet: null,         // { tripId, stopId, orderId } | null
    exceptionSheet: null,   // { tripId, stopId } | null
    addTripSheet: false,
  };
}

let state = freshState();

/* Explicit in-app navigation stack, not the browser's history. window.history
   is unreliable here: it survives restartFlow()/switchFlow() resetting state,
   so the browser's "back" could land on a screen built for a driver record
   that no longer exists, and it does nothing predictable when there's no
   prior entry at all (e.g. the very first screen in a fresh tab). This stack
   is cleared exactly when state is, so it can never point at a stale screen. */
let navHistory = [];

function setHash(route) {
  if (window.location.hash === '#' + route) {
    // Setting hash to its current value doesn't fire 'hashchange' — render
    // directly so navigating "back to" the screen you're already on (e.g.
    // restarting a flow from its own landing screen) still takes effect.
    render();
  } else {
    window.location.hash = route;
  }
}

const App = {

  nav(route) {
    const current = currentRoute();
    if (current !== route) navHistory.push(current);
    setHash(route);
  },

  switchFlow(flow) {
    state = freshState();
    navHistory = [];
    state.activeFlow = flow;
    // A returning driver already granted location on their first onboarding —
    // that grant persists at the OS level, so there's nothing to (re-)ask on
    // a normal sign-in. See the reviewer note on returning-entry for the
    // actual conditions that would retrigger it for real.
    if (flow === 'returning') state.locationPermission = 'always';
    // setHash, not this.nav — nav() would push the pre-reset route onto the
    // (just-cleared) history, letting "back" step into a screen this fresh
    // state no longer matches.
    setHash(FLOW_FIRST_ROUTE[flow]);
  },

  restartFlow() {
    const meta = ROUTE_META[currentRoute()];
    const flow = state.activeFlow || (meta && meta.flow) || null;
    state = freshState();
    navHistory = [];
    if (flow) {
      state.activeFlow = flow;
      if (flow === 'returning') state.locationPermission = 'always';
      setHash(FLOW_FIRST_ROUTE[flow]);
    } else {
      setHash('self-reg-welcome');
    }
  },

  back() {
    setHash(navHistory.pop() || 'self-reg-welcome');
  },

  set(key, value) {
    state[key] = value;
  },

  setAndRerender(key, value) {
    state[key] = value;
    render();
  },

  toggle(key) {
    state[key] = !state[key];
    render();
  },

  toggleTheme() {
    const html = document.documentElement;
    const goingDark = !html.classList.contains('dark');
    html.classList.remove('light', 'dark', 'sl-theme-light', 'sl-theme-dark');
    html.classList.add(goingDark ? 'dark' : 'light', goingDark ? 'sl-theme-dark' : 'sl-theme-light');
    try { localStorage.setItem('cca-theme', goingDark ? 'dark' : 'light'); } catch (e) { /* ignore */ }
    render();
  },

  otpInput(el, boxIndex, groupSelector, stateKey) {
    const val = el.value.replace(/[^0-9]/g, '').slice(-1);
    el.value = val;
    const boxes = Array.from(document.querySelectorAll(groupSelector));
    state[stateKey] = boxes.map(b => b.value).join('');
    if (val && boxIndex < boxes.length - 1) {
      boxes[boxIndex + 1].focus();
    }
    updateFooterState();
  },

  otpKeydown(e, boxIndex, groupSelector) {
    if (e.key === 'Backspace' && !e.target.value && boxIndex > 0) {
      const boxes = Array.from(document.querySelectorAll(groupSelector));
      boxes[boxIndex - 1].focus();
    }
  },

  pinPress(digit) {
    if (state.pin.length >= 4) return;
    state.pin += String(digit);
    if (state.pin.length === 4) {
      setTimeout(() => {
        if (state.pinTarget === 'dashboard') {
          this.enterDashboard(state.dashboardMode);
        } else {
          this.nav(state.pinTarget);
        }
      }, 350);
    }
    render();
  },

  pinBackspace() {
    state.pin = state.pin.slice(0, -1);
    render();
  },

  toggleExpand(id, current) {
    state.stopExpandOverride[id] = !current;
    render();
  },

  confirmMilestone(tripId, stopId, milestoneId) {
    completeMilestoneByIds(tripId, stopId, milestoneId);
    render();
  },

  /* Same completion mechanics as confirmMilestone — a separate method name
     because the two are semantically different actions for the driver: this
     one attests to something the app has no way to detect on its own (cargo
     physically loaded/unloaded), not confirming an automated proposal. */
  markManualDone(tripId, stopId, milestoneId) {
    completeMilestoneByIds(tripId, stopId, milestoneId);
    render();
  },

  /* Records the pallet count the driver typed in by hand for one order —
     there's no automated extraction to confirm or correct, just a number
     they counted themselves. Pallet exchange is logged per customer order
     (kickoff-pack.md line 40), so this mirrors submitPod(): once every
     order at the stop has a driver-entered count, the stage completes
     itself. A count that doesn't match what was expected for that order is
     flagged (`palletMismatch`) as a structured exception for ops to
     review, not reconciled silently. */
  confirmPalletCount(tripId, stopId, orderId) {
    const input = document.getElementById(`pallet-input-${orderId}`);
    const trip = findActiveTrip(tripId);
    const stop = trip && findStop(trip, stopId);
    const order = stop && stop.orders.find(o => o.id === orderId);
    if (order && input && input.value !== '') {
      order.actualPallets = parseInt(input.value, 10);
      order.palletMismatch = order.actualPallets !== order.expectedPallets;
      order.palletConfirmed = true;
    }
    if (stop && stop.orders.every(o => o.palletConfirmed)) {
      const idx = stop.milestones.findIndex(m => m.kind === 'pallet-exchange');
      if (idx >= 0 && stop.milestones[idx].status !== 'confirmed') {
        completeMilestone(trip, stop, idx);
      }
    }
    render();
  },

  startEditTimestamp(stopId, milestoneId) {
    state.editingMilestone = { stopId, milestoneId };
    render();
  },

  cancelEditTimestamp() {
    state.editingMilestone = null;
    render();
  },

  saveTimestamp(tripId, stopId, milestoneId) {
    const input = document.getElementById(`ts-input-${milestoneId}`);
    const trip = findActiveTrip(tripId);
    const stop = trip && findStop(trip, stopId);
    const m = stop && stop.milestones.find(x => x.id === milestoneId);
    if (m && input) m.timestamp = input.value || m.timestamp;
    state.editingMilestone = null;
    render();
  },

  openPodSheet(tripId, stopId, orderId) {
    state.podSheet = { tripId, stopId, orderId };
    render();
  },

  closePodSheet() {
    state.podSheet = null;
    render();
  },

  submitPod() {
    const { tripId, stopId, orderId } = state.podSheet;
    const trip = findActiveTrip(tripId);
    const stop = trip && findStop(trip, stopId);
    const order = stop && stop.orders.find(o => o.id === orderId);
    if (order) order.podUploaded = true;
    // Once every order at this stop has a POD, the POD stage completes itself —
    // it's gated on the orders, not on a single tap the way other stages are.
    if (stop && stop.orders.every(o => o.podUploaded)) {
      const podIdx = stop.milestones.findIndex(m => m.kind === 'pod');
      if (podIdx >= 0 && stop.milestones[podIdx].status !== 'confirmed') {
        completeMilestone(trip, stop, podIdx);
      }
    }
    state.podSheet = null;
    render();
  },

  openExceptionSheet(tripId, stopId) {
    state.exceptionSheet = { tripId, stopId };
    render();
  },

  closeExceptionSheet() {
    state.exceptionSheet = null;
    render();
  },

  submitException() {
    const { tripId, stopId } = state.exceptionSheet;
    const trip = findActiveTrip(tripId);
    const stop = trip && findStop(trip, stopId);
    const typeEl = document.getElementById('exception-type');
    const orderEl = document.getElementById('exception-order');
    const descEl = document.getElementById('exception-description');
    if (stop) {
      const typeValue = typeEl ? typeEl.value : EXCEPTION_TYPES[0].value;
      const typeLabel = (EXCEPTION_TYPES.find(t => t.value === typeValue) || EXCEPTION_TYPES[0]).label;
      stop.exceptions.push({
        type: typeLabel,
        orderId: orderEl && orderEl.value !== '__all' ? orderEl.value : null,
        description: descEl ? descEl.value : '',
      });
    }
    state.exceptionSheet = null;
    render();
  },

  openAddTripSheet() {
    state.addTripSheet = true;
    render();
  },

  closeAddTripSheet() {
    state.addTripSheet = false;
    render();
  },

  submitAddTrip() {
    const input = document.getElementById('add-trip-ref');
    const ref = input && input.value.trim();
    if (ref) {
      state.scheduledTrips.push({
        id: ref.toUpperCase(), pickup: 'Details pending', dropoff: '—',
        status: 'Pending', badge: 'warning', eta: 'Awaiting confirmation from ops',
      });
    }
    state.addTripSheet = false;
    render();
  },

  /* Bottom tab bar — a direct hash switch, not this.nav(), since tabs are
     sibling top-level destinations rather than a back-stack of screens. */
  goTab(route) {
    setHash(route);
  },

  approveDashboard() {
    state.dashboardMode = 'full';
    if (!state.locationPermission) {
      this.nav('location-priming');
    } else {
      render();
    }
  },

  /* Single entry point for "land on the dashboard" — the moment of first real
     trip visibility, and per permission-priming best practice, the right moment
     to ask for location access rather than asking blindly during onboarding. */
  enterDashboard(mode) {
    state.dashboardMode = mode;
    if (!state.locationPermission) {
      this.nav('location-priming');
    } else {
      this.nav('dashboard');
    }
  },
};

function currentRoute() {
  // No standalone "choose a flow" screen — a real driver never picks between
  // Self-Registration/Portal/Returning/Guest as an in-app menu (that choice
  // is made for them by how they arrived: fresh install, an SMS link, or
  // already having an account). Self-Registration's own welcome screen is
  // the actual front door; the other flows are reached via a real deep link
  // (or, for review, the flow-switcher bar above the device).
  return window.location.hash.replace('#', '') || 'self-reg-welcome';
}

function h(strings, ...values) {
  return strings.reduce((acc, str, i) => acc + str + (values[i] !== undefined ? values[i] : ''), '');
}

/* Compact row for a trip that isn't underway yet — Scheduled/Upcoming section
   only. Nothing to act on until it becomes the active trip, so it isn't tappable. */
function tripCard(trip) {
  return h`
    <div class="card trip-card">
      <div class="trip-card__top">
        <span class="t-label-md">${trip.id}</span>
        <span class="badge badge--${trip.badge}">${trip.status}</span>
      </div>
      <div class="t-body-sm t-muted">${trip.pickup} &#8594; ${trip.dropoff}</div>
      <div class="t-body-sm t-caption">${trip.status === 'Completed' ? '' : 'ETA '}${trip.eta}</div>
    </div>
  `;
}

/* Time-of-day greeting for the dashboard header — small touch, but it's the
   difference between "Welcome" (a system talking) and a driver feeling checked-in on. */
function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/* Which mock driver record is "you" right now — depends on which onboarding
   path this session took. Shared by the dashboard hero and the Profile tab. */
function currentDriverIdentity() {
  const name = state.activeFlow === 'self-reg' ? `${state.firstName} ${state.lastName}`
    : state.activeFlow === 'returning' ? `${MOCK_RETURNING_DRIVER.firstName} ${MOCK_RETURNING_DRIVER.lastName}`
    : `${MOCK_PLANNER_RECORD.firstName} ${MOCK_PLANNER_RECORD.lastName}`;
  const carrier = state.activeFlow === 'self-reg' ? MOCK_PLANNER_RECORD.carrier
    : state.activeFlow === 'returning' ? MOCK_RETURNING_DRIVER.carrier
    : MOCK_PLANNER_RECORD.carrier;
  const phone = state.activeFlow === 'returning' ? MOCK_RETURNING_DRIVER.phone : (state.phone || MOCK_PLANNER_RECORD.phone);
  return { name, carrier, phone };
}

/* Whether a given <sl-details> (a stop card, or the trip accordion itself) should
   render open. Defaults to "the active stop / the trip itself" is open; anything
   the driver has manually toggled is remembered in state.stopExpandOverride so a
   later re-render (e.g. confirming a milestone elsewhere) doesn't silently re-collapse
   something they opened themselves — full re-renders replace the DOM every time,
   so this can't rely on <sl-details> tracking its own open state across renders. */
function isExpanded(id, defaultOpen) {
  return id in state.stopExpandOverride ? state.stopExpandOverride[id] : defaultOpen;
}

function findActiveTrip(tripId) {
  return state.activeTrips.find(t => t.id === tripId) || (state.guestTrip.id === tripId ? state.guestTrip : null);
}

function findStop(trip, stopId) {
  return trip.stops.find(s => s.id === stopId);
}

/* An order picked up at one stop is the same order delivered at another, so
   it appears in both stops' `orders` lists — summing stop.orders.length
   double-counts it. Count distinct order ids across the whole trip instead. */
function distinctOrderCount(trip) {
  return new Set(trip.stops.flatMap(s => s.orders.map(o => o.id))).size;
}

function formatNowTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/* Completes one stage of a stop's lifecycle and cascades: unlocks the next
   stage (proposed for an auto stage, ready for a manual one, ready for POD so
   its per-order rows appear), and — on a stop's last stage — hands the trip's
   activeStopId to the next stop in route order, so the whole trip advances,
   not just one stop in isolation. */
function completeMilestone(trip, stop, index) {
  const m = stop.milestones[index];
  m.status = 'confirmed';
  if (!m.timestamp) m.timestamp = formatNowTime();
  if (m.kind === 'manual' && !m.source) m.source = 'manual';

  const next = stop.milestones[index + 1];
  if (next && next.status === 'pending') {
    if (next.kind === 'manual' || next.kind === 'pod' || next.kind === 'pallet-exchange') {
      next.status = 'ready';
    } else if (next.kind === 'auto') {
      next.status = 'proposed';
      next.source = 'automated';
      next.timestamp = formatNowTime();
    }
  }

  if (index === stop.milestones.length - 1) {
    const stopIdx = trip.stops.findIndex(s => s.id === stop.id);
    const nextStop = trip.stops[stopIdx + 1];
    if (nextStop) trip.activeStopId = nextStop.id;
  }
}

function completeMilestoneByIds(tripId, stopId, milestoneId) {
  const trip = findActiveTrip(tripId);
  const stop = trip && findStop(trip, stopId);
  const idx = stop ? stop.milestones.findIndex(x => x.id === milestoneId) : -1;
  if (idx >= 0) completeMilestone(trip, stop, idx);
}

/* One or more "Active Trip" accordions — the dashboard's main content. Each is
   its own <sl-details>, open by default (see isExpanded above), so a driver can
   collapse a trip to get it out of the way without losing anything else on the
   dashboard. Takes an array so this scales past one truck/trip, even though V1
   never actually has more than one active at a time. */
function activeTripSection(trips) {
  return trips.map(trip => h`
    <sl-details class="active-trip" ${isExpanded(trip.id, true) ? 'open' : ''} onclick="if (event.target.closest('sl-details') === this && event.target.closest('[data-role=summary]')) App.toggleExpand('${trip.id}', ${isExpanded(trip.id, true)})">
      <div slot="summary" data-role="summary" class="active-trip__summary">
        <div class="active-trip__summary-top">
          <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;">
            <div style="display:flex;align-items:center;gap:10px;">
              <span class="t-label-md">${trip.id}</span>
              <span class="badge badge--info">In Transit</span>
            </div>
            <span class="t-body-sm t-caption">${trip.stops.length} stop${trip.stops.length === 1 ? '' : 's'} &middot; ${distinctOrderCount(trip)} order${distinctOrderCount(trip) === 1 ? '' : 's'}</span>
          </div>
          <sl-icon class="active-trip__summary-chevron" name="chevron-down"></sl-icon>
        </div>
      </div>
      <div class="active-trip__timeline">${stopTimelineList(trip)}</div>
    </sl-details>
  `).join('');
}

/* Current stop pinned to the top (not chronological-from-start), everything
   else following in actual route order below — scroll to reach any other
   stop, past or future, non-sequentially. */
function stopTimelineList(trip) {
  const active = findStop(trip, trip.activeStopId);
  const rest = trip.stops.filter(s => s.id !== trip.activeStopId);
  const ordered = active ? [active, ...rest] : trip.stops;
  return h`<div class="stop-list">${ordered.map(stop => stopItem(trip, stop)).join('')}</div>`;
}

function stopStatus(stop) {
  const real = stop.milestones.filter(m => m.kind !== 'eta');
  if (real.every(m => m.status === 'confirmed')) return 'completed';
  if (real.some(m => m.status !== 'pending')) return 'active';
  return 'upcoming';
}

/* Flat, hairline-and-dot hierarchy instead of cards nested inside cards —
   the stop and its stages read as one continuous, scannable list rather than
   boxes within boxes within boxes. */
function stopItem(trip, stop) {
  const status = stopStatus(stop);
  const isActive = stop.id === trip.activeStopId;
  const expanded = isExpanded(stop.id, isActive);
  const orderCount = stop.orders.length;
  const isCollapsed = !expanded && status === 'upcoming';
  return h`
    <div class="stop-item stop-item--${status}">
      <sl-details ${expanded ? 'open' : ''} onclick="if (event.target.closest('sl-details') === this && event.target.closest('[data-role=summary]')) App.toggleExpand('${stop.id}', ${expanded})">
        <div slot="summary" data-role="summary" class="stop-summary ${isCollapsed ? 'stop-summary--collapsed' : ''}">
          <span class="stop-item__dot">${status === 'completed' ? h`<sl-icon name="check-lg"></sl-icon>` : ''}</span>
          <div class="stop-summary__content ${isCollapsed ? 'stop-summary__content--collapsed' : ''}">
            <div class="stop-summary__main">
              <div class="stop-summary__title">
                <span class="t-label-md">${stop.type === 'pickup' ? 'Pickup' : 'Delivery'}</span>
                <span class="badge badge--category">${orderCount} Order${orderCount === 1 ? '' : 's'}</span>
                ${stop.exceptions.length ? h`<sl-icon class="exception-flag" name="exclamation-triangle" title="Exception reported"></sl-icon>` : ''}
              </div>
              <span class="t-body-sm" style="color:var(--text-neutral-subtitle)">${stop.location}</span>
              <div class="stop-summary__window">
                <span class="t-label-sm">Window:</span>
                <span class="t-label-sm">${stop.appointment}</span>
              </div>
            </div>
            <sl-icon class="stop-summary__chevron" name="${expanded ? 'chevron-down' : 'chevron-right'}"></sl-icon>
          </div>
        </div>
        <div class="stop-body">
          <div class="stage-list">${stop.milestones.map(m => stageItem(trip, stop, m)).join('')}</div>
          <button type="button" class="report-issue-link" onclick="App.openExceptionSheet('${trip.id}','${stop.id}')">
            <sl-icon name="flag" aria-hidden="true"></sl-icon> Report an issue with this stop
          </button>
        </div>
      </sl-details>
    </div>
  `;
}

/* "Automated" was papering over two genuinely different mechanisms: a
   geofence detecting arrival/departure vs. a driver's own manual action.
   Naming the actual mechanism is more meaningful to a driver than the
   generic word — and more honest, since they're really not the same thing
   under the hood. */
function stageSourceLabel(m) {
  if (m.source === 'manual') return 'Manual';
  if (m.source === 'automated') return m.kind === 'auto' ? 'Geofence' : 'Automated';
  return '';
}

/* One stage in a stop's lifecycle — see pickupStages()/deliveryStages() for
   the 'eta' | 'auto' | 'manual' | 'pod' kinds this renders differently. */
function stageItem(trip, stop, m) {
  const editing = state.editingMilestone && state.editingMilestone.milestoneId === m.id;
  const dotClass = m.status === 'confirmed' ? 'done'
    : (m.status === 'proposed' || m.status === 'ready') ? 'active'
    : m.status === 'eta' ? 'eta' : 'todo';
  // Pallet exchange has no stage-level count any more — it's logged per
  // customer order (see palletExchangeOrderRow()), same shape as 'pod'.
  const hasOrderRows = m.kind === 'pod' || m.kind === 'pallet-exchange';
  const anyPalletMismatch = m.kind === 'pallet-exchange' && m.status === 'confirmed' && stop.orders.some(o => o.palletMismatch);

  const editIconSvg = '<img class="stage-item__edit-icon" src="assets/icon-edit.svg" alt="edit" />';
  let right;
  if (editing) {
    right = h`
      <div class="timestamp-edit">
        <sl-input id="ts-input-${m.id}" type="time" size="small" value="${m.timestamp || ''}"></sl-input>
        <sl-button size="small" variant="primary" onclick="App.saveTimestamp('${trip.id}','${stop.id}','${m.id}')">Save</sl-button>
        <sl-button size="small" onclick="App.cancelEditTimestamp()">Cancel</sl-button>
      </div>
    `;
  } else if (m.kind === 'eta') {
    right = h`<div class="stage-item__time-row"><span class="stage-item__time-chip"><button type="button" class="timestamp-btn" onclick="App.startEditTimestamp('${stop.id}','${m.id}')">${m.timestamp}</button>${editIconSvg}</span><span class="stage-item__source">Calculated</span></div>`;
  } else if (m.status === 'pending') {
    right = h`<span class="stage-item__status-text">Not yet reached</span>`;
  } else if (!m.timestamp) {
    right = h`<span class="stage-item__status-text">Awaiting driver</span>`;
  } else {
    const sourceLabel = stageSourceLabel(m);
    right = h`<div class="stage-item__time-row"><span class="stage-item__time-chip stage-item__time-chip--filled"><button type="button" class="timestamp-btn timestamp-btn--bold" onclick="App.startEditTimestamp('${stop.id}','${m.id}')">${m.timestamp}</button>${editIconSvg}</span>${sourceLabel ? h`<span class="stage-item__source">${sourceLabel}</span>` : ''}</div>`;
  }

  let action = '';
  if (!editing) {
    if (m.status === 'proposed') {
      action = h`<button type="button" class="stage-confirm-btn" onclick="App.confirmMilestone('${trip.id}','${stop.id}','${m.id}')">Confirm</button>`;
    } else if (m.status === 'ready' && m.kind === 'manual') {
      action = h`<button type="button" class="stage-confirm-btn" onclick="App.markManualDone('${trip.id}','${stop.id}','${m.id}')">Mark done</button>`;
    }
  }

  const labelClass = m.status === 'pending' ? 't-body-sm' : (m.status === 'proposed' || m.status === 'ready') ? 't-label-sm' : 't-body-sm';
  const labelColor = m.status === 'pending' ? 'color:var(--text-neutral-subtitle)' : 'color:var(--text-neutral-body)';
  return h`
    <div class="stage-item stage-item--${dotClass}">
      <div class="stage-item__row">
        <span class="stage-item__dot">${dotClass === 'done' ? h`<sl-icon name="check"></sl-icon>` : ''}</span>
        <div class="stage-item__main">
          <div class="stage-item__label-line">
            <span class="${labelClass}" style="${labelColor}">${m.label}</span>
            ${anyPalletMismatch ? h`<span class="badge badge--warning">Mismatch</span>` : ''}
          </div>
          ${right}
        </div>
        <div class="stage-item__action">${action}</div>
      </div>
      ${hasOrderRows && m.status !== 'pending' ? h`<div class="stage-item__sub">${stop.orders.map(o => m.kind === 'pod' ? orderRow(trip, stop, o) : palletExchangeOrderRow(trip, stop, o)).join('')}</div>` : ''}
    </div>
  `;
}

function orderRow(trip, stop, order) {
  return h`
    <div class="order-row">
      <div class="order-row__label">
        <span class="t-body-sm t-label-md">${order.ref}</span>
        <span class="t-body-sm t-caption">${order.podUploaded ? 'POD uploaded' : 'POD not yet uploaded'}</span>
      </div>
      ${order.podUploaded
        ? h`<span class="badge badge--success"><sl-icon name="check2"></sl-icon> Done</span>`
        : h`<sl-button size="small" onclick="App.openPodSheet('${trip.id}','${stop.id}','${order.id}')">Upload POD</sl-button>`}
    </div>
  `;
}

/* Pallet exchange, logged per customer order (kickoff-pack.md line 40) —
   same row shape as orderRow() above, but a driver-typed count instead of
   a file upload. No pre-filled value: there's no automated extraction to
   seed it with (see keep-brand-artifacts-separate re: Corax/NewCold). */
function palletExchangeOrderRow(trip, stop, order) {
  if (order.palletConfirmed) {
    return h`
      <div class="order-row">
        <div class="order-row__label">
          <span class="t-body-sm t-label-md">${order.ref}</span>
          <span class="t-body-sm t-caption">${order.actualPallets} pallets${order.palletMismatch ? ` (expected ${order.expectedPallets})` : ''}</span>
        </div>
        ${order.palletMismatch
          ? h`<span class="badge badge--warning"><sl-icon name="exclamation-triangle"></sl-icon> Mismatch</span>`
          : h`<span class="badge badge--success"><sl-icon name="check2"></sl-icon> Confirmed</span>`}
      </div>
    `;
  }
  return h`
    <div class="order-row order-row--stacked">
      <div class="order-row__label">
        <span class="t-body-sm t-label-md">${order.ref}</span>
        <span class="t-body-sm t-caption">Expected ${order.expectedPallets} pallets</span>
      </div>
      <div class="order-row__pallet-entry">
        <sl-input id="pallet-input-${order.id}" class="pallet-count-input" type="number" size="small" placeholder="Actual count"></sl-input>
        <sl-button size="small" variant="primary" onclick="App.confirmPalletCount('${trip.id}','${stop.id}','${order.id}')">Confirm</sl-button>
      </div>
    </div>
  `;
}

/* POD upload — real modal sheet (bottom drawer), per order at a delivery stop.
   Matches what's actually built today (mobile-app-status.md): a mandatory POD
   document plus an optional cargo photo — no signature/notes fields exist yet,
   so none are invented here. */
function podSheetMarkup() {
  const open = !!state.podSheet;
  let order = null, stop = null;
  if (open) {
    const trip = findActiveTrip(state.podSheet.tripId);
    stop = trip && findStop(trip, state.podSheet.stopId);
    order = stop && stop.orders.find(o => o.id === state.podSheet.orderId);
  }
  return h`
    <sl-drawer id="pod-drawer" label="Upload POD" placement="bottom" ${open ? 'open' : ''}>
      ${open ? h`
        <div class="sheet-body">
          <div class="t-body-sm t-muted">${order.ref} &middot; ${stop.location}</div>
          <div class="sheet-field">
            <label class="t-label-sm">POD document <span class="t-caption">(required)</span></label>
            <input type="file" accept="image/*,.pdf" capture="environment" />
          </div>
          <div class="sheet-field">
            <label class="t-label-sm">Cargo photo <span class="t-caption">(optional)</span></label>
            <input type="file" accept="image/*" capture="environment" />
          </div>
        </div>
        <div slot="footer" style="display:flex; gap:8px;">
          <sl-button style="flex:1;" onclick="App.closePodSheet()">Cancel</sl-button>
          <sl-button style="flex:1;" variant="primary" onclick="App.submitPod()">Submit POD</sl-button>
        </div>
      ` : ''}
    </sl-drawer>
  `;
}

/* Exception reporting — real modal sheet, originated for this design since no
   structured flow exists anywhere yet (today it's phone-call-only). Fields
   chosen to match the V1 "structured exception capture" goal from the kickoff:
   a type, which order it affects (only asked when the stop has more than one),
   a description, and optional photo evidence. */
/* sl-option values can't contain spaces (Shoelace silently mangles them) — slug
   for the value, human label for the visible text and the stored record. */
const EXCEPTION_TYPES = [
  { value: 'delay', label: 'Delay' },
  { value: 'damaged-goods', label: 'Damaged goods' },
  { value: 'missing-items', label: 'Missing items' },
  { value: 'pallet-mismatch', label: 'Pallet mismatch' },
  { value: 'site-access', label: 'Site access issue' },
  { value: 'vehicle-issue', label: 'Vehicle issue' },
  { value: 'other', label: 'Other' },
];

function exceptionSheetMarkup() {
  const open = !!state.exceptionSheet;
  let stop = null;
  if (open) {
    const trip = findActiveTrip(state.exceptionSheet.tripId);
    stop = trip && findStop(trip, state.exceptionSheet.stopId);
  }
  return h`
    <sl-drawer id="exception-drawer" label="Report an issue" placement="bottom" ${open ? 'open' : ''}>
      ${open ? h`
        <div class="sheet-body">
          <div class="t-body-sm t-muted">${stop.location}</div>
          <div class="sheet-field">
            <label class="t-label-sm">What kind of issue?</label>
            <sl-select id="exception-type" placeholder="Select one">
              ${EXCEPTION_TYPES.map(t => h`<sl-option value="${t.value}">${t.label}</sl-option>`).join('')}
            </sl-select>
          </div>
          ${stop.orders.length > 1 ? h`
            <div class="sheet-field">
              <label class="t-label-sm">Affected order</label>
              <sl-select id="exception-order" value="__all">
                <sl-option value="__all">Whole stop</sl-option>
                ${stop.orders.map(o => h`<sl-option value="${o.id}">${o.ref}</sl-option>`).join('')}
              </sl-select>
            </div>
          ` : ''}
          <div class="sheet-field">
            <label class="t-label-sm">Description</label>
            <sl-textarea id="exception-description" rows="3" placeholder="What happened?"></sl-textarea>
          </div>
          <div class="sheet-field">
            <label class="t-label-sm">Photo evidence <span class="t-caption">(optional)</span></label>
            <input type="file" accept="image/*" capture="environment" />
          </div>
        </div>
        <div slot="footer" style="display:flex; gap:8px;">
          <sl-button style="flex:1;" onclick="App.closeExceptionSheet()">Cancel</sl-button>
          <sl-button style="flex:1;" variant="primary" onclick="App.submitException()">Submit</sl-button>
        </div>
      ` : ''}
    </sl-drawer>
  `;
}

/* Self-service "I have a reference number" trip claim — distinct from the
   Guest/One-Off flow (that's ops inviting an unregistered driver to one trip).
   This is an already-registered driver adding an extra trip themselves, e.g.
   one handed to them outside the normal assignment path. No real lookup exists
   in this prototype, so an added trip lands as "Pending" rather than faking
   invented pickup/drop-off details for an arbitrary reference. */
function addTripSheetMarkup() {
  const open = !!state.addTripSheet;
  return h`
    <sl-drawer id="add-trip-drawer" label="Add a trip" placement="bottom" ${open ? 'open' : ''}>
      ${open ? h`
        <div class="sheet-body">
          <div class="t-body-sm t-muted">Enter the trip reference number your carrier or dispatch gave you.</div>
          <div class="sheet-field">
            <label class="t-label-sm">Trip reference number</label>
            <sl-input id="add-trip-ref" placeholder="e.g. TRIP2026-000125"></sl-input>
          </div>
        </div>
        <div slot="footer" style="display:flex; gap:8px;">
          <sl-button style="flex:1;" onclick="App.closeAddTripSheet()">Cancel</sl-button>
          <sl-button style="flex:1;" variant="primary" onclick="App.submitAddTrip()">Add trip</sl-button>
        </div>
      ` : ''}
    </sl-drawer>
  `;
}

/* Notifications feed — mostly derived live from actual trip state (a proposed
   milestone awaiting confirm, a reported exception) rather than static mock
   copy, so it stays honest about what's actually happened in the session. */
function notificationItems() {
  const items = [];
  state.activeTrips.forEach(trip => {
    trip.stops.forEach(stop => {
      stop.milestones.forEach(m => {
        if (m.status === 'proposed') {
          items.push({ icon: 'geo-alt', tone: 'warning', text: `${m.label} detected at ${stop.location} — confirm to continue`, time: m.timestamp });
        }
      });
      stop.exceptions.forEach(e => {
        items.push({ icon: 'exclamation-triangle', tone: 'critical', text: `${e.type} reported at ${stop.location}`, time: '' });
      });
    });
  });
  state.scheduledTrips.forEach(t => {
    items.push({ icon: 'calendar-event', tone: 'info', text: `Trip ${t.id} scheduled — ${t.pickup} → ${t.dropoff}`, time: t.eta });
  });
  return items;
}

function notificationRow(item) {
  return h`
    <div class="card notification-row">
      <sl-icon class="notification-row__icon" name="${item.icon}"></sl-icon>
      <div class="notification-row__body">
        <div class="t-body-md">${item.text}</div>
        ${item.time ? h`<div class="t-body-sm t-caption">${item.time}</div>` : ''}
      </div>
    </div>
  `;
}

/* ---------- Bottom tab bar (Dashboard / My Trips / Notifications / Chats / Profile) ----------
   Only shown once a driver has real dashboard access (dashboardMode 'full') —
   guest access stays deliberately minimal (single trip, no account, no nav),
   and the locked/pending-approval state has nothing yet to navigate to. */
const ICON_DASHBOARD = '<svg class="app-tabbar__icon-img" width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12M21 12C21 7.02944 16.9706 3 12 3M21 12H18.75M3 12C3 7.02944 7.02944 3 12 3M3 12H5.25M12 3V5.25M18.3706 5.7L13.3499 10.65M18.3706 18.3706L18.1871 18.1871C17.5645 17.5644 17.2531 17.2531 16.8898 17.0305C16.5677 16.8331 16.2166 16.6877 15.8492 16.5995C15.4349 16.5 14.9946 16.5 14.1141 16.5L9.88586 16.5C9.00534 16.5 8.56508 16.5 8.15076 16.5995C7.78343 16.6877 7.43228 16.8332 7.11018 17.0305C6.74688 17.2532 6.43557 17.5645 5.81294 18.1871L5.62947 18.3706M5.62947 5.7L7.19227 7.26281M13.8 12C13.8 12.9941 12.9941 13.8 12 13.8C11.0059 13.8 10.2 12.9941 10.2 12C10.2 11.0059 11.0059 10.2 12 10.2C12.9941 10.2 13.8 11.0059 13.8 12Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_TRIP = '<svg class="app-tabbar__icon-img" width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M11.4999 5.00064H11.9343C14.9816 5.00064 16.5052 5.00064 17.0836 5.54793C17.5835 6.02101 17.8051 6.71792 17.6701 7.39285C17.5139 8.17366 16.27 9.0535 13.7822 10.8132L9.71763 13.6881C7.22982 15.4478 5.9859 16.3276 5.82975 17.1084C5.69477 17.7834 5.91633 18.4803 6.41628 18.9534C6.99465 19.5006 8.51827 19.5006 11.5655 19.5006H12.4999M18.0576 17.0006V17.0106M6.05762 6.00061V6.01061M20.1786 19.1216C20.5983 18.7021 20.8841 18.1676 20.9999 17.5856C21.1158 17.0036 21.0564 16.4004 20.8294 15.8522C20.6023 15.3039 20.2178 14.8353 19.7244 14.5057C19.2311 14.176 18.651 14 18.0576 14C17.4642 14 16.8842 14.176 16.3908 14.5057C15.8975 14.8353 15.5129 15.3039 15.2859 15.8522C15.0589 16.4004 14.9995 17.0036 15.1153 17.5856C15.2312 18.1676 15.517 18.7021 15.9366 19.1216C16.3546 19.5406 17.0616 20.1666 18.0576 21.0006C19.1086 20.1106 19.8166 19.4846 20.1786 19.1216ZM8.17862 8.12161C8.59827 7.70209 8.88408 7.16754 8.99991 6.58557C9.11574 6.00361 9.05638 5.40036 8.82934 4.85213C8.60231 4.3039 8.21779 3.83531 7.72442 3.50562C7.23106 3.17594 6.651 2.99997 6.05762 2.99997C5.46423 2.99997 4.88418 3.17594 4.39081 3.50562C3.89745 3.83531 3.51293 4.3039 3.28589 4.85213C3.05886 5.40036 2.9995 6.00361 3.11533 6.58557C3.23116 7.16754 3.51697 7.70209 3.93662 8.12161C4.35462 8.54061 5.06162 9.16661 6.05762 10.0006C7.10862 9.11061 7.81662 8.48461 8.17862 8.12161Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const TAB_ITEMS = [
  { route: 'dashboard', svg: ICON_DASHBOARD, label: 'Dashboard' },
  { route: 'nav-trips', svg: ICON_TRIP, label: 'My Trips' },
  { route: 'nav-chats', icon: 'chat-dots', label: 'Chats' },
  { route: 'nav-profile', icon: 'person', label: 'Profile' },
];
const TAB_ROUTES = TAB_ITEMS.map(t => t.route);

function tabBarMarkup(activeRoute) {
  return h`
    <div class="app-tabbar">
      ${TAB_ITEMS.map(item => h`
        <button type="button" class="app-tabbar__item ${item.route === activeRoute ? 'is-active' : ''}" onclick="App.goTab('${item.route}')">
          ${item.svg ? item.svg : h`<sl-icon class="app-tabbar__icon" name="${item.icon}"></sl-icon>`}
          <span class="app-tabbar__label">${item.label}</span>
        </button>
      `).join('')}
    </div>
  `;
}

/* ---------------------------------------------------------------- */
/* Screen renderers */
/* ---------------------------------------------------------------- */

const SCREENS = {

  /* ---------------- SELF-REGISTRATION ---------------- */

  'self-reg-welcome': () => ({
    hideHeader: true,
    transparentStatusBar: true,
    content: h`
      <div class="launch-hero">
        <div class="launch-hero__sheen"></div>
        <div class="launch-hero__body">
          <div class="launch-hero__mark">
            <span class="launch-hero__mark-ring"></span>
            <img class="launch-hero__icon" src="assets/logo-icon-white.svg" alt="" />
          </div>
          <div class="launch-hero__wordmark">CtrlChain</div>
          <div class="launch-hero__tagline">Moving transport forward</div>
        </div>
        <div class="launch-hero__actions" role="group" aria-label="Sign up or log in options">
          <div class="launch-hero__divider"><span>Sign up or log in with</span></div>
          <button class="btn btn-social" onclick="App.set('activeFlow','self-reg'); App.nav('self-reg-social-google')">
            <img class="btn-social__icon" src="assets/social-google.svg" alt="" /> Continue with Google
          </button>
          <button class="btn btn-social" onclick="App.set('activeFlow','self-reg'); App.nav('self-reg-social-apple')">
            <img class="btn-social__icon" src="assets/social-apple.svg" alt="" /> Continue with Apple
          </button>
          <div class="launch-hero__divider launch-hero__divider--secondary"><span>Continue with</span></div>
          <button class="btn launch-hero__secondary" onclick="App.set('activeFlow','self-reg'); App.nav('self-reg-signup')">Email or phone number</button>
          <button class="btn launch-hero__secondary" onclick="App.set('activeFlow','portal'); App.nav('portal-code')">Activation code</button>
          <button class="btn-link launch-hero__signin" onclick="App.switchFlow('returning')">Already have an account? Sign in</button>
        </div>
      </div>
    `,
  }),

  'self-reg-social-google': () => oauthConsentScreen('google'),
  'self-reg-social-apple': () => oauthConsentScreen('apple'),

  'self-reg-signup': () => ({
    content: h`
      <div class="t-body-md t-muted">No site or QR code needed — works for any pickup location.</div>
      <div class="segmented">
        <div class="segmented__opt ${state.loginMethod === 'phone' ? 'is-selected' : ''}" onclick="App.setAndRerender('loginMethod','phone')">Phone</div>
        <div class="segmented__opt ${state.loginMethod === 'email' ? 'is-selected' : ''}" onclick="App.setAndRerender('loginMethod','email')">Email</div>
      </div>
      ${state.loginMethod === 'phone' ? h`
        <div class="field">
          <label class="field__label">Mobile number</label>
          <div class="phone-input">
            <button type="button" class="phone-input__code" aria-label="Change country code">
              <span class="phone-input__flag">&#127475;&#127473;</span>
              <span>+31</span>
              <svg class="phone-input__chevron" width="10" height="6" viewBox="0 0 10 6" fill="none"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <div class="phone-input__number-wrap">
              <input class="phone-input__number" type="tel" inputmode="numeric" placeholder="6 12345678" value="${state.phone}" oninput="App.set('phone', this.value); this.nextElementSibling.style.visibility = this.value ? 'visible' : 'hidden'; updateFooterState();" />
              <button type="button" class="phone-input__clear" aria-label="Clear" style="visibility:${state.phone ? 'visible' : 'hidden'}" onclick="App.setAndRerender('phone','')"><sl-icon name="x-lg"></sl-icon></button>
            </div>
          </div>
        </div>
      ` : ''}
      ${state.loginMethod === 'email' ? h`
        <div class="field">
          <label class="field__label">Email address</label>
          <input class="field__input" type="email" placeholder="you@example.com" value="${state.email}" oninput="App.set('email', this.value); updateFooterState();" />
        </div>
      ` : ''}
    `,
    footer: () => {
      const ready = state.loginMethod === 'phone' ? state.phone.length >= 6 : state.email.includes('@');
      return h`<button class="btn btn-primary" ${ready ? '' : 'disabled'} onclick="App.nav('self-reg-otp')">Continue</button>`;
    },
  }),

  'self-reg-otp': () => ({
    content: h`
      <div class="t-body-md t-muted">Enter the 6-digit code we sent to ${state.loginMethod === 'email' ? (state.email || 'your email') : (state.phone || 'your number')}.</div>
      <div class="otp-row">
        ${[0,1,2,3,4,5].map(i => h`<input class="otp-box" inputmode="numeric" maxlength="1" oninput="App.otpInput(this, ${i}, '.otp-box', 'otp')" onkeydown="App.otpKeydown(event, ${i}, '.otp-box')" />`).join('')}
      </div>
      <button class="btn-link">Resend code</button>
    `,
    footer: () => h`<button class="btn btn-primary" ${state.otp.length === 6 ? '' : 'disabled'} onclick="App.nav('self-reg-password')">Verify</button>`,
    reviewerNote: h`<div class="reviewer-sticky__title">Reviewer note</div>No real SMS is sent — any 6 digits will verify.`,
  }),

  'self-reg-password': () => ({
    content: h`
      <div class="t-body-md t-muted">Set a password so you can sign back in later, even if this device is reset or replaced.</div>
      <div class="field">
        <label class="field__label">Password</label>
        <input class="field__input" type="password" placeholder="At least 8 characters" value="${state.password}" oninput="App.set('password', this.value); updateFooterState();" />
        <div class="field__hint">Use at least 8 characters.</div>
      </div>
    `,
    footer: () => h`<button class="btn btn-primary" ${state.password.length >= 8 ? '' : 'disabled'} onclick="App.nav('self-reg-details')">Continue</button>`,
  }),

  'self-reg-details': () => ({
    content: h`
      <div class="t-body-md t-muted">Your vehicle isn't needed yet — that's assigned per trip, later.</div>
      <div class="field">
        <label class="field__label">First name</label>
        <input class="field__input" placeholder="Jordan" value="${state.firstName}" oninput="App.set('firstName', this.value); updateFooterState();" />
      </div>
      <div class="field">
        <label class="field__label">Last name</label>
        <input class="field__input" placeholder="Reyes" value="${state.lastName}" oninput="App.set('lastName', this.value); updateFooterState();" />
      </div>
    `,
    footer: () => h`<button class="btn btn-primary" ${(state.firstName && state.lastName) ? '' : 'disabled'} onclick="App.nav('self-reg-gdpr')">Continue</button>`,
  }),

  'self-reg-gdpr': () => {
    const screen = gdprScreen('self-reg-pin', 'gdprAccepted');
    screen.footer = () => h`<button class="btn btn-primary" ${state.gdprAccepted ? '' : 'disabled'} onclick="App.set('pinTarget','dashboard'); App.set('dashboardMode','locked'); App.nav('self-reg-pin')">Accept &amp; continue</button>`;
    return screen;
  },

  'self-reg-pin': () => pinScreen('setup'),

  /* ---------------- PORTAL-BASED (MAGIC LINK) ---------------- */

  'portal-sms': () => messagesAppScreen({
    sender: 'CtrlChain',
    body: h`You've been added as a driver by <strong>${MOCK_PLANNER_RECORD.carrier}</strong> on CtrlChain. Your activation code: <strong>${MOCK_ACTIVATION_CODE}</strong><br/>`,
    link: 'app.ctrlchain.com/invite/8f2a1c&hellip;',
    onLinkTap: "App.nav('portal-install')",
    reviewerNote: h`
      <div class="reviewer-sticky__title">Why this looks like Messages</div>
      A real invite SMS opens the phone's own Messages app, not CtrlChain's UI — styled that way on purpose so it's never mistaken for an in-app screen. Tap the link bubble to continue.
    `,
  }),

  // A plain app-store link, sent separately from the code — no deferred
  // deep-linking dependency. This happens before the driver has CtrlChain
  // open at all, so it can't be one of our own numbered in-app screens; it's
  // styled to read as the App Store, not as step 2 of onboarding. Either path
  // (install, or already have it) ends at the same place: portal-code, the
  // app's real first screen once actually opened.
  'portal-install': () => ({
    hideHeader: true,
    content: h`
      <div class="appstore-mock">
        <div class="appstore-mock__nav">&#8249; App Store</div>
        <div class="appstore-mock__card">
          <div class="appstore-mock__icon"><img src="assets/logo-icon.svg" alt="" /></div>
          <div class="appstore-mock__title">CtrlChain Driver</div>
          <div class="appstore-mock__subtitle">Business</div>
          <button type="button" class="appstore-mock__get" onclick="App.nav('portal-code')">GET</button>
        </div>
        <div class="appstore-mock__caption">Track pickups, confirm milestones, and manage trips on the go.</div>
      </div>
    `,
    reviewerNote: h`
      <div class="reviewer-sticky__title">Reviewer shortcut</div>
      A returning driver who already has the app wouldn't see this screen at all.
      <button type="button" class="reviewer-sticky__action" onclick="App.nav('portal-code')">Skip straight to the code</button>
    `,
  }),

  'portal-code': () => ({
    content: h`
      <div class="t-body-md t-muted">Enter the 8-digit activation code from the SMS.</div>
      <div class="otp-row otp-row--compact">
        ${[0,1,2,3,4,5,6,7].map(i => h`<input class="otp-box" inputmode="numeric" maxlength="1" oninput="App.otpInput(this, ${i}, '.otp-box', 'portalCode')" onkeydown="App.otpKeydown(event, ${i}, '.otp-box')" />`).join('')}
      </div>
    `,
    reviewerNote: h`<div class="reviewer-sticky__title">Reviewer note</div>No real SMS is sent — any 8 digits will work.`,
    footer: () => h`<button class="btn btn-primary" ${state.portalCode.length === 8 ? '' : 'disabled'} onclick="App.nav('portal-confirm')">Continue</button>`,
  }),

  'portal-confirm': () => {
    const record = currentPortalRecord();
    return {
      content: h`
        <div class="t-body-md t-muted">${state.reactivating ? "Pre-filled with what's already on file — check it's still correct." : "Pre-filled with what your planner entered — check it's correct."}</div>
        <div class="field">
          <label class="field__label">Name</label>
          <div class="readonly-field">${record.firstName} ${record.lastName}</div>
        </div>
        <div class="field">
          <label class="field__label">Carrier</label>
          <div class="readonly-field">${record.carrier}</div>
        </div>
        <div class="field">
          <label class="field__label">Phone on file</label>
          <div class="readonly-field">${record.phone}</div>
        </div>
      `,
      // The 8-digit activation code (portal-code) already proved the driver
      // holds this phone number — a second OTP here would just re-check the
      // same channel. Straight to PIN setup for both first-time and
      // reactivating drivers.
      footer: () => h`<button class="btn btn-primary" onclick="App.set('pinTarget','portal-gdpr'); App.nav('portal-pin')">This is me — continue</button>`,
    };
  },

  'portal-pin': () => pinScreen('setup'),

  /* No separate "you're all set" screen — a Portal-Based driver is already
     vetted by ops (that's the whole point of this path), so there's nothing
     left to confirm once GDPR is accepted. Straight to the dashboard. */
  'portal-gdpr': () => {
    const screen = gdprScreen('dashboard', 'portalGdprAccepted');
    screen.footer = () => h`<button class="btn btn-primary" ${state.portalGdprAccepted ? '' : 'disabled'} onclick="App.enterDashboard('full')">Accept &amp; continue</button>`;
    return screen;
  },

  /* ---------------- RETURNING DRIVER ---------------- */

  'returning-entry': () => ({
    hideHeader: true,
    content: h`
      <div class="center-state">
        <sl-icon class="center-state__icon center-state__icon--success" name="phone"></sl-icon>
        <div class="t-headline-md">Welcome back</div>
        <div class="t-body-md t-muted">Checking your session&hellip;</div>
      </div>
    `,
    reviewerNote: h`
      <div class="reviewer-sticky__title">Reviewer controls</div>
      A real app checks the session silently and lands straight on the right screen. Pick a scenario:
      <div class="t-body-sm" style="margin-top:8px; font-weight:600;">Originally signed up via</div>
      <button type="button" class="reviewer-sticky__action" onclick="App.setAndRerender('returningOrigin','self-reg')">Self-Registered${state.returningOrigin === 'self-reg' ? ' &#10003;' : ''}</button>
      <button type="button" class="reviewer-sticky__action" onclick="App.setAndRerender('returningOrigin','portal')">Portal-Based${state.returningOrigin === 'portal' ? ' &#10003;' : ''}</button>
      <div class="t-body-sm" style="margin-top:10px; font-weight:600;">Session state</div>
      <button type="button" class="reviewer-sticky__action" onclick="App.set('pinTarget','dashboard'); App.set('dashboardMode','full'); App.nav('returning-pin')">Session still valid</button>
      <button type="button" class="reviewer-sticky__action" onclick="App.nav(state.returningOrigin === 'portal' ? 'returning-request-activation' : 'returning-password')">Session expired</button>
      <div class="t-body-sm" style="margin-top:10px; font-weight:600;">Why no location prompt here</div>
      <div class="t-body-sm">Already granted on first onboarding, and that persists at the OS level. It would only ask again if: permission was revoked in Settings, or the app later needs a stronger level than what's already granted (e.g. upgrading While Using to Always).</div>
    `,
  }),

  'returning-pin': () => pinScreen('unlock'),

  'returning-password': () => ({
    content: h`
      <div class="t-body-md t-muted">Your session expired — the device doesn't have you signed in anymore. Sign in the same way you originally set up your account.</div>
      <div class="field">
        <label class="field__label">Email address</label>
        <input class="field__input" type="email" placeholder="you@example.com" value="${state.returningEmail}" oninput="App.set('returningEmail', this.value); updateFooterState();" />
      </div>
      <div class="field">
        <label class="field__label">Password</label>
        <input class="field__input" type="password" placeholder="&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;" value="${state.returningPassword}" oninput="App.set('returningPassword', this.value); updateFooterState();" />
      </div>
      <button class="btn-link">Forgot password?</button>
    `,
    footer: () => h`<button class="btn btn-primary" ${(state.returningEmail.includes('@') && state.returningPassword.length >= 4) ? '' : 'disabled'} onclick="App.enterDashboard('full')">Sign in</button>`,
  }),

  'returning-request-activation': () => ({
    content: h`
      <div class="t-body-md t-muted">Portal-Based accounts don't have a separate password — your PIN or Face ID is the only way in. Enter the email or phone number on your account to reactivate it.</div>
      <div class="field">
        <label class="field__label">Email or phone number</label>
        <input class="field__input" type="text" placeholder="you@example.com or +31 6 12345678" value="${state.reactivationContact}" oninput="App.set('reactivationContact', this.value); updateFooterState();" />
      </div>
      <div class="card card--tinted">
        <div class="t-label-md">What happens next</div>
        <div class="t-body-sm t-muted">We'll automatically send an 8-digit code to confirm it's you — no approval wait, and nothing for your carrier's ops team to action.</div>
      </div>
    `,
    footer: () => h`<button class="btn btn-primary" ${state.reactivationContact.trim().length >= 4 ? '' : 'disabled'} onclick="App.nav('returning-activation-sent')">Reactivate my account</button>`,
  }),

  'returning-activation-sent': () => ({
    content: h`
      <div class="t-body-md t-muted">Enter the 8-digit code we sent to ${state.reactivationContact}.</div>
      <div class="otp-row otp-row--compact">
        ${[0,1,2,3,4,5,6,7].map(i => h`<input class="otp-box" inputmode="numeric" maxlength="1" oninput="App.otpInput(this, ${i}, '.otp-box', 'reactivationCode')" onkeydown="App.otpKeydown(event, ${i}, '.otp-box')" />`).join('')}
      </div>
      <button class="btn-link">Resend code</button>
    `,
    footer: () => h`<button class="btn btn-primary" ${state.reactivationCode.length === 8 ? '' : 'disabled'} onclick="App.set('reactivating', true); App.nav('portal-confirm')">Verify</button>`,
    reviewerNote: h`<div class="reviewer-sticky__title">Reviewer note</div>No real SMS is sent — any 8 digits will verify.`,
  }),

  /* ---------------- GUEST / ONE-OFF DRIVER ---------------- */

  'guest-sms': () => messagesAppScreen({
    sender: 'CtrlChain',
    body: h`You've been given temporary access to <strong>Trip ${MOCK_GUEST_TRIP.id}</strong> by <strong>${MOCK_PLANNER_RECORD.carrier}</strong>.<br/>`,
    link: `app.ctrlchain.com/trip/${MOCK_GUEST_TRIP.id}?t=e91a&hellip;`,
    onLinkTap: "App.nav('guest-trust')",
    reviewerNote: h`
      <div class="reviewer-sticky__title">Why this looks like Messages</div>
      Styled like the phone's own Messages app, not CtrlChain's UI, so it's never mistaken for an in-app screen. Tap the link bubble to continue.
    `,
  }),

  /* Trust (who added you, and how to verify that) and scope (no account, no
     password, ends automatically) used to be two separate steps — merged
     into one: a real driver reads both in the same glance, and neither
     message needed a screen of its own to land. Reached only by tapping the
     link in the SMS mock, so there's nothing real to go "back" to. */
  'guest-trust': () => ({
    hideBack: true,
    content: h`
      <div class="card card--tinted" style="text-align:center; align-items:center; padding:28px 20px;">
        <sl-icon name="check-circle-fill" style="font-size:32px; color:var(--success-text);"></sl-icon>
        <div class="t-headline-md">You've been added to Trip ${MOCK_GUEST_TRIP.id} by ${MOCK_PLANNER_RECORD.carrier}</div>
        <div class="t-body-sm t-muted">You can confirm this with ${MOCK_PLANNER_RECORD.carrier} directly if anything looks off.</div>
      </div>
      <div class="t-body-md t-muted">No email, no password, no account created. Access ends automatically when the trip is complete.</div>
      <div class="card trip-card" style="text-align:left; width:100%;">
        <div class="trip-card__top"><span class="t-label-md">${MOCK_GUEST_TRIP.id}</span></div>
        <div class="t-body-sm t-muted">${MOCK_GUEST_TRIP.stops[0].location} &#8594; ${MOCK_GUEST_TRIP.stops[MOCK_GUEST_TRIP.stops.length - 1].location}</div>
      </div>
    `,
    footer: () => h`<button class="btn btn-primary" onclick="App.enterDashboard('guest')">Continue to trip</button>`,
  }),

  /* ---------------- LOCATION PERMISSION PRIMING ----------------
     Shown once, contextually, the first time a driver would actually see a
     real trip — not blindly during onboarding. Requests "Always" because V1's
     geofence-assisted arrival detection only works with the app backgrounded;
     "While Using" can't support that. The native-style screens deliberately
     model iOS's real two-step Always flow (first ask never offers Always
     outright) since that's exactly what CtrlChain's own app has shipped bugs
     around before (re-prompting after already granted, going "active" without
     real permission) — see onboarding-design-decisions.md. */

  'location-priming': () => ({
    hideHeader: true,
    content: h`
      <div class="center-state">
        <sl-icon class="center-state__icon center-state__icon--success" name="geo-alt"></sl-icon>
        <div class="t-headline-md">Enable location for automatic tracking</div>
        <div class="t-body-md t-muted">CtrlChain uses your location to automatically detect pickup arrival and share live ETA — so you're not manually updating every milestone. Updates are sent periodically, not continuously, to save battery.</div>
      </div>
    `,
    footer: () => h`
      <button class="btn btn-primary" onclick="App.nav('location-os-prompt-1')">Enable location</button>
      <button class="btn-text" onclick="App.set('locationPermission','while-using'); App.nav('dashboard')">Not now</button>
    `,
  }),

  'location-os-prompt-1': () => ({
    hideHeader: true,
    content: h`
      <div class="os-alert-backdrop">
        <div class="os-alert">
          <div class="os-alert__title">Allow &ldquo;CtrlChain&rdquo; to use your location?</div>
          <div class="os-alert__message">Your location is used to detect pickup arrival and share live trip updates with your carrier.</div>
          <div class="os-alert__actions">
            <!-- "Once" is ephemeral and doesn't persist across app opens — real
                 iOS never follows it with the Always-upgrade prompt, only a
                 persistent "While Using" grant earns that follow-up. -->
            <button class="os-alert__btn" onclick="App.set('locationPermission','once'); App.nav('dashboard')">Allow Once</button>
            <button class="os-alert__btn" onclick="App.set('locationPermission','while-using'); App.nav('location-os-prompt-2')">Allow While Using App</button>
            <button class="os-alert__btn os-alert__btn--muted" onclick="App.set('locationPermission','denied'); App.nav('location-denied')">Don't Allow</button>
          </div>
        </div>
      </div>
    `,
  }),

  'location-os-prompt-2': () => ({
    hideHeader: true,
    content: h`
      <div class="os-alert-backdrop">
        <div class="os-alert">
          <div class="os-alert__title">Allow &ldquo;CtrlChain&rdquo; to also access your location even when you're not using the app?</div>
          <div class="os-alert__message">This lets CtrlChain detect your arrival automatically, even if the app isn't open while you're driving.</div>
          <div class="os-alert__actions">
            <button class="os-alert__btn os-alert__btn--muted" onclick="App.nav('dashboard')">Keep Only While Using</button>
            <button class="os-alert__btn" onclick="App.set('locationPermission','always'); App.nav('dashboard')">Change to Always Allow</button>
          </div>
        </div>
      </div>
    `,
  }),

  'location-denied': () => ({
    hideHeader: true,
    content: h`
      <div class="center-state">
        <sl-icon class="center-state__icon center-state__icon--warning" name="exclamation-triangle"></sl-icon>
        <div class="t-headline-md">Location access needed</div>
        <div class="t-body-md t-muted">Without location access, arrival and ETA won't update automatically — you'll need to confirm each milestone manually. You can enable it anytime in Settings.</div>
      </div>
    `,
    footer: () => h`
      <button class="btn btn-primary" onclick="App.nav('location-priming')">Open Settings</button>
      <button class="btn-text" onclick="App.nav('dashboard')">Continue without location</button>
    `,
  }),

  /* ---------------- SHARED DASHBOARD ---------------- */

  'dashboard': () => {
    if (state.dashboardMode === 'locked') {
      return {
        hideBack: true,
        content: h`
          <div class="dash-header">
            <div class="t-headline-md">${greeting()}, ${state.firstName || 'there'}</div>
            <div class="t-body-sm t-muted">${MOCK_PLANNER_RECORD.carrier}</div>
          </div>
          <div class="approval-banner">
            <sl-icon class="approval-banner__icon" name="hourglass-split"></sl-icon>
            <div class="approval-banner__text">
              <div class="t-label-md">Registration pending Ops approval</div>
              <div class="t-body-sm">Usually takes about 30 minutes — you'll get a notification the moment it's done.</div>
              <div class="approval-banner__ref">Reference ${MOCK_REGISTRATION_REF} <span class="t-caption">— sent to your email and phone. Quote it if you contact ${MOCK_PLANNER_RECORD.carrier} about a delay.</span></div>
            </div>
          </div>
          <div class="dash-section">
            <div class="t-label-sm t-caption dash-section__label">ACTIVE TRIP</div>
            <div class="empty-state">
              <sl-icon class="empty-state__icon" name="clipboard"></sl-icon>
              <div class="t-body-md t-muted">No trips yet</div>
              <div class="t-body-sm t-caption">Trips appear here once your registration is approved.</div>
            </div>
          </div>
        `,
        reviewerNote: h`
          <div class="reviewer-sticky__title">Reviewer shortcut</div>
          A real driver has no way to self-approve — Ops does this from the back office.
          <button type="button" class="reviewer-sticky__action" onclick="App.approveDashboard()">Simulate Ops approval</button>
        `,
      };
    }
    if (state.dashboardMode === 'guest') {
      return {
        hideBack: true,
        content: h`
          <div class="dash-header">
            <div class="t-headline-md">${greeting()}</div>
            <span class="badge badge--info">Guest access — this trip only</span>
          </div>
          ${trackingStatusBanner()}
          ${activeTripSection([state.guestTrip])}
          <div class="card">
            <div class="t-body-sm t-muted">This access ends automatically once the trip is marked complete — nothing to clean up.</div>
          </div>
          ${podSheetMarkup()}
          ${exceptionSheetMarkup()}
        `,
      };
    }
    // full
    const { name, carrier } = currentDriverIdentity();
    return {
      content: h`
        <div class="dash-hero">
          <div class="dash-hero__top">
            <div>
              <div class="t-headline-md">${greeting()}, ${name.split(' ')[0] || 'driver'}</div>
              <div class="dash-hero__sub t-body-sm">${carrier}</div>
            </div>
            <button type="button" class="btn-link" style="font-size:12px;" onclick="App.openAddTripSheet()">+ Add trip</button>
          </div>
          ${trackingStatusBanner()}
        </div>
        <div class="dash-section">
          <div class="t-label-sm t-caption dash-section__label">ACTIVE TRIP</div>
          ${activeTripSection(state.activeTrips)}
        </div>
        <div class="dash-section">
          <div class="t-label-sm t-caption dash-section__label">SCHEDULED</div>
          ${state.scheduledTrips.length
            ? state.scheduledTrips.map(t => tripCard(t)).join('')
            : h`<div class="t-body-sm t-caption dash-empty-note">Nothing scheduled beyond the active trip.</div>`}
        </div>
        ${podSheetMarkup()}
        ${exceptionSheetMarkup()}
        ${addTripSheetMarkup()}
      `,
    };
  },

  /* ---------------- BOTTOM TAB SCREENS ---------------- */

  'nav-trips': () => {
    const active = state.dashboardMode === 'guest' ? [state.guestTrip] : state.activeTrips;
    return {
      content: h`
        <div class="dash-section">
          <div class="t-label-sm t-caption dash-section__label">ACTIVE</div>
          ${active.map(trip => h`
            <div class="card trip-card trip-card--tappable" style="border-radius:10px;padding:12px;" onclick="App.goTab('dashboard')">
              <div class="trip-card__top">
                <div style="display:flex;align-items:center;gap:10px;">
                  <span class="t-label-md">${trip.id}</span>
                  <span class="badge badge--info">In Transit</span>
                </div>
                <sl-icon name="chevron-right" style="font-size:20px;color:var(--text-neutral-caption);"></sl-icon>
              </div>
              <div class="t-body-sm t-caption">${trip.stops.length} stop${trip.stops.length === 1 ? '' : 's'} &middot; ${distinctOrderCount(trip)} order${distinctOrderCount(trip) === 1 ? '' : 's'}</div>
            </div>
          `).join('')}
        </div>
        <div class="dash-section">
          <div class="dash-section__row">
            <span class="t-label-sm t-caption dash-section__label">SCHEDULED</span>
            <button type="button" class="btn-link" style="font-size:12px;" onclick="App.openAddTripSheet()">+ Add trip</button>
          </div>
          ${state.scheduledTrips.length
            ? state.scheduledTrips.map(t => tripCard(t)).join('')
            : h`<div class="t-body-sm t-caption dash-empty-note">Nothing scheduled.</div>`}
        </div>
        <div class="dash-section">
          <div class="t-label-sm t-caption dash-section__label">HISTORY</div>
          ${MOCK_TRIP_HISTORY.map(t => tripCard(t)).join('')}
        </div>
        ${addTripSheetMarkup()}
      `,
    };
  },

  'nav-notifications': () => {
    const items = notificationItems();
    return {
      content: h`
        ${items.length
          ? items.map(n => notificationRow(n)).join('')
          : h`<div class="center-state"><div class="t-body-md t-muted">Nothing new right now.</div></div>`}
      `,
    };
  },

  'nav-chats': () => ({
    content: h`
      <div class="center-state">
        <sl-icon class="center-state__icon center-state__icon--warning" name="chat-dots"></sl-icon>
        <div class="t-headline-md">Chat with back-office</div>
        <div class="t-body-md t-muted">Structured messaging with your carrier's back office is planned but not yet defined for this prototype.</div>
      </div>
    `,
  }),

  'nav-profile': () => {
    const { name, carrier, phone } = currentDriverIdentity();
    return {
      content: h`
        <div class="card">
          <div class="t-label-lg">${name}</div>
          <div class="t-body-sm t-muted">${carrier}</div>
          <div class="t-body-sm t-muted">${phone}</div>
        </div>
      `,
    };
  },
};

function pinScreen(mode) {
  const isSetup = mode !== 'unlock';
  const screen = {
    content: h`
      <div class="t-body-md t-muted" style="text-align:center;">${isSetup ? 'Set a 4-digit PIN for quick sign-in next time.' : 'Enter your PIN to continue.'}</div>
      <div class="pin-dots">
        ${[0,1,2,3].map(i => h`<div class="pin-dot ${state.pin.length > i ? 'is-filled' : ''}"></div>`).join('')}
      </div>
      <div class="pin-pad">
        ${[1,2,3,4,5,6,7,8,9].map(n => h`<button class="pin-key" onclick="App.pinPress(${n})">${n}</button>`).join('')}
        <div class="pin-key pin-key--ghost"></div>
        <button class="pin-key" onclick="App.pinPress(0)">0</button>
        <button class="pin-key" onclick="App.pinBackspace()"><sl-icon name="backspace"></sl-icon></button>
      </div>
      ${isSetup ? h`<div class="t-body-sm t-caption" style="text-align:center;">Required — this is how you'll sign back in on this device.</div>` : ''}
    `,
  };
  if (!isSetup) {
    screen.footer = () => h`<button class="btn-link" onclick="App.nav(state.pinTarget)">Use Face ID instead</button>`;
  }
  return screen;
}

function gdprScreen(nextRoute, stateKey, pinTargetToSet) {
  return {
    content: h`
      <div class="t-body-md t-muted">Last step. This is tied to your account — you'll be asked again if terms change.</div>
      <div class="card" style="max-height:220px; overflow-y:auto;">
        <div class="t-body-sm t-muted">
          CtrlChain processes your name, phone number, and trip-related location data to operate the driver app,
          coordinate pickups and deliveries, and meet carrier obligations. Data is retained per applicable
          transport and data-protection regulations and is never sold to third parties. You may request access
          to or deletion of your data at any time via your carrier's back office.
        </div>
      </div>
      <div class="check-row" onclick="App.toggle('${stateKey}')">
        <div class="check-box ${state[stateKey] ? 'is-checked' : ''}">${state[stateKey] ? h`<sl-icon name="check2"></sl-icon>` : ''}</div>
        <div class="t-body-md">I have read and accept the Terms of Service and Privacy Policy.</div>
      </div>
    `,
    footer: () => h`<button class="btn btn-primary" ${state[stateKey] ? '' : 'disabled'} onclick="${pinTargetToSet ? `App.set('pinTarget','${pinTargetToSet}'); ` : ''}App.nav('${nextRoute}')">Accept &amp; continue</button>`,
  };
}

function oauthConsentScreen(provider) {
  const p = OAUTH_PROVIDERS[provider];
  // The whole point of social login is not re-asking for what the provider
  // already gave us — name included, not just email.
  const choose = (email, name) => {
    const parts = (name || '').trim().split(' ');
    const first = parts[0] || '';
    const last = parts.slice(1).join(' ');
    return `App.set('loginMethod','social'); App.set('email','${email}'); App.set('phone','${provider}-account'); App.set('firstName','${first}'); App.set('lastName','${last}'); App.nav('self-reg-details')`;
  };
  return {
    hideHeader: true,
    content: h`
      <div class="oauth-sheet">
        <div class="oauth-sheet__bar">
          <button class="oauth-sheet__cancel" onclick="App.nav('self-reg-welcome')">Cancel</button>
          <div class="oauth-sheet__url"><span>&#128274;</span> ${p.domain}</div>
          <button class="oauth-sheet__reload" aria-label="Reload">&#8635;</button>
        </div>
        <div class="oauth-sheet__provider">
          <img class="oauth-sheet__provider-icon" src="${p.logo}" alt="" /> Sign in with ${p.label}
        </div>
        <div class="oauth-sheet__body">
          <div class="oauth-sheet__title">Choose an account</div>
          <div class="oauth-sheet__subtitle">to continue to <strong>CtrlChain</strong></div>
          ${p.accounts.map(a => h`
            <div class="oauth-account" onclick="${choose(a.email, a.name)}">
              <div class="oauth-account__avatar" style="background:${a.color};">${a.initial}</div>
              <div class="oauth-account__body">
                <div class="oauth-account__name">${a.name}</div>
                <div class="oauth-account__email">${a.email}</div>
              </div>
              ${a.signedOut ? '<div class="oauth-account__status">Signed out</div>' : ''}
            </div>
          `).join('')}
          <div class="oauth-account" onclick="${choose(provider + '.driver@example.com')}">
            <div class="oauth-account__avatar oauth-account__avatar--ghost">&#128100;</div>
            <div class="oauth-account__name">Use another account</div>
          </div>
          <div class="oauth-sheet__disclosure">To continue, ${p.label} will share your ${p.share} with CtrlChain.</div>
        </div>
      </div>
    `,
  };
}

/* Mocks the phone's native Messages app — deliberately breaks from CCA's own
   UI (no header, no brand colors) so reviewers don't mistake "a text message
   arrives" for an in-app screen. Tapping the link (or the whole bubble, for
   forgiveness) is the only interactive element; the rest is inert chrome. */
function messagesAppScreen({ sender, body, link, onLinkTap, reviewerNote }) {
  return {
    hideHeader: true,
    content: h`
      <div class="messages-mock">
        <div class="messages-mock__bar">
          <span class="messages-mock__back">&#8249; Messages</span>
          <span class="messages-mock__contact">${sender}</span>
          <span class="messages-mock__icon">&#9432;</span>
        </div>
        <div class="messages-mock__body">
          <div class="messages-mock__timestamp">Today 9:41</div>
          <div class="messages-mock__bubble" onclick="${onLinkTap}">
            ${body}
            <a class="messages-mock__link">${link}</a>
          </div>
        </div>
      </div>
    `,
    reviewerNote,
  };
}

/* Compact inline status — a dot and one line of text, not a big colored
   banner. Persistent state deserves low visual weight; it's ambient context,
   not something competing with the trip data for attention. */
function trackingStatusBanner() {
  if (state.locationPermission === 'always') {
    return h`<div class="tracking-status"><span class="tracking-status__dot tracking-status__dot--active"></span>Automatic tracking active</div>`;
  }
  return h`
    <div class="tracking-status tracking-status--limited">
      <span class="tracking-status__dot tracking-status__dot--limited"></span>
      <span class="tracking-status__text">Background tracking limited — arrival won't auto-detect.</span>
      <button type="button" class="tracking-status__fix" onclick="App.nav('location-priming')">Fix</button>
    </div>
  `;
}

/* ---------------------------------------------------------------- */
/* Render loop */
/* ---------------------------------------------------------------- */

function updateFooterState() {
  const footerEl = document.querySelector('.app-footer');
  const screen = SCREENS[currentRoute()];
  if (footerEl && screen) {
    const rendered = screen();
    if (rendered.footer) footerEl.innerHTML = rendered.footer();
  }
}

function render() {
  const route = currentRoute();
  const screen = SCREENS[route] ? SCREENS[route]() : SCREENS['self-reg-welcome']();
  const meta = ROUTE_META[route];
  // Guest access stays deliberately minimal (single trip, no account, no nav —
  // an established principle, not an oversight) and the locked/pending-approval
  // state has nothing yet to navigate to, so the tab bar is 'full' mode only.
  const isTabRoute = TAB_ROUTES.includes(route) && state.dashboardMode === 'full';
  // The welcome screen, every bottom-tab screen, and any screen reached by
  // tapping a link in an external mock (screen.hideBack) are top-level
  // destinations — nothing a real driver could go "back" to from there.
  const canGoBack = route !== 'self-reg-welcome' && !isTabRoute && !screen.hideBack;

  let headerHtml = '';
  if (!screen.hideHeader) {
    const progressPct = meta ? Math.round((meta.step / meta.total) * 100) : 0;
    // The notification bell lives in the persistent header (not the
    // scrollable dashboard hero) specifically so it stays reachable no
    // matter how far the driver has scrolled down the trip timeline —
    // "always accessible" per Samuel's direct feedback, not just visible
    // at the top of the page.
    const showBell = route === 'dashboard' && state.dashboardMode === 'full';
    const unreadCount = showBell ? notificationItems().length : 0;
    const rightSlot = showBell
      ? h`<button type="button" class="app-header__bell" onclick="App.goTab('nav-notifications')" aria-label="Notifications">
            <sl-icon name="bell"></sl-icon>
            ${unreadCount ? h`<span class="app-header__bell-dot"></span>` : ''}
          </button>`
      : meta ? h`<div class="app-header__step t-body-sm">${meta.step} / ${meta.total}</div>` : h`<div class="app-header__spacer"></div>`;
    headerHtml = h`
      <div class="app-header">
        <div class="app-header__row">
          <button class="app-header__back" onclick="App.back()" ${canGoBack ? '' : 'style="visibility:hidden"'}><sl-icon name="arrow-left"></sl-icon></button>
          <div class="app-header__title t-headline-md">${TITLES[route] || ''}</div>
          ${rightSlot}
        </div>
        ${meta ? h`<div class="app-progress"><div class="app-progress__fill" style="width:${progressPct}%"></div></div>` : ''}
      </div>
    `;
  }

  const footerHtml = isTabRoute
    ? tabBarMarkup(route)
    : (screen.footer ? h`<div class="app-footer">${screen.footer()}</div>` : '');

  const statusBar = document.querySelector('.status-bar');
  if (statusBar) statusBar.classList.toggle('status-bar--overlay', !!screen.transparentStatusBar);

  document.getElementById('app').innerHTML = h`
    ${headerHtml}
    <div class="app-content">${screen.content}</div>
    ${footerHtml}
  `;

  document.querySelectorAll('.proto-flow-btn').forEach(btn => {
    btn.classList.toggle('is-active', state.activeFlow === btn.dataset.flow);
  });

  // sl-drawer emits a custom `sl-request-close` event (its own close button,
  // clicking the overlay, or Escape) — inline HTML attributes like
  // onsl-request-close="..." do NOT wire up custom events the way onclick
  // does (that only works for events with a matching native on* IDL
  // property), so this needs a real addEventListener. Every render() rebuilds
  // the DOM from scratch, so these are re-attached fresh each time.
  const drawerClosers = {
    'pod-drawer': () => App.closePodSheet(),
    'exception-drawer': () => App.closeExceptionSheet(),
    'add-trip-drawer': () => App.closeAddTripSheet(),
  };
  Object.keys(drawerClosers).forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('sl-request-close', drawerClosers[id]);
  });

  const themeBtn = document.querySelector('.proto-theme-btn');
  if (themeBtn) {
    const isDark = document.documentElement.classList.contains('dark');
    themeBtn.textContent = isDark ? '☀️' : '🌙';
    themeBtn.title = isDark ? 'Switch to light theme' : 'Switch to dark theme';
  }

  // Anything a reviewer needs — but a real driver never would — lives in this
  // sticky outside the device, never inside the simulated screen itself.
  const sticky = document.getElementById('reviewer-sticky');
  if (sticky) {
    if (screen.reviewerNote) {
      sticky.innerHTML = screen.reviewerNote;
      sticky.style.display = 'block';
    } else {
      sticky.innerHTML = '';
      sticky.style.display = 'none';
    }
  }
}

window.addEventListener('hashchange', render);
window.addEventListener('DOMContentLoaded', render);

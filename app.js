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
   geofence-detectable arrival/departure bookend cargo loading/unloading,
   with POD its own gated step on delivery stops. There's no sensor inside
   the trailer, so "cargo loaded/unloaded" can't be detected on its own —
   it's inferred from the same geofence-exit signal that detects departure
   and proposed alongside it, same as arrival, with the driver able to
   correct the timestamp if the geofence fired early/late (Samuel's call,
   2026-08-24: this used to be a manual-only "Mark done" stage). `kind`
   drives both how a stage is rendered and how it can complete:
     'eta'    — informational only, never confirmable, always visible once set.
     'auto'   — geofence-detectable; proposed automatically, driver confirms.
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
   'ready' (pod/pallet-exchange stage unlocked, awaiting the driver)
   | 'proposed' (auto stage awaiting confirm) | 'confirmed' (done)
   | 'assumed' (auto-resolved after driver never confirmed — carries an
     "unverified" flag; see confirmation-confidence-design.md).
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
    { id: 'loaded', label: 'Cargo loaded', kind: 'auto', status: 'pending', source: null, timestamp: null },
    { id: 'departed', label: 'Departed pickup', kind: 'auto', status: 'pending', source: null, timestamp: null }
  );
  return stages;
}
function deliveryStages(etaTime) {
  return [
    { id: 'eta', label: 'Delivery ETA', kind: 'eta', status: 'eta', source: null, timestamp: etaTime },
    { id: 'arrived', label: 'Arrived at delivery', kind: 'auto', status: 'pending', source: null, timestamp: null },
    { id: 'unloaded', label: 'Cargo unloaded', kind: 'auto', status: 'pending', source: null, timestamp: null },
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
    status: 'In Transit',
    contact: { name: 'John Doe', company: 'CtrlChain B.V.' },
    vehicle: 'VX72 YYM',
    trailer: '570859',
    references: { 'STOP-1': '570859', 'STOP-2': 'Not Added yet' },
    // Consolidated, 2 orders — both are loaded at the one pickup and both are
    // delivered at the one delivery, so the same two orders appear at both
    // stops (previously PO-33211 only appeared at delivery, as if it had never
    // been picked up — fixed here).
    stops: [
      {
        id: 'STOP-1', type: 'pickup', location: 'Meridian Distribution Centre, Coventry', appointment: '08:00 – 09:00',
        orders: [
          { id: 'ORD-8841937', ref: '#CCA2025-001030.1', customer: 'Freiberger UK Ltd', expectedPallets: 7, weight: 270, actualPallets: null, palletConfirmed: false, palletMismatch: false,
            instructions: 'IMPORTANT: include in Assign Driver this information:\nFirst Name: First and Last Name\nLast Name: Driver\'s ID\n\n1- The driver must present himself at the access control and register.\n2- Once registered, he/she will check if he/she can enter the pier or must wait until called by phone.\n3- Once assigned the pier will be directed towards him/her, if it is busy you must wait for another vehicle.\n\nThe use of PPE, reflective waistcoat and safety shoes is mandatory.',
            cargo: { totalItems: 9, perishable: 'Non Perishable', tempSensitive: false, loadingMethod: 'Side Loading', hazardous: false,
              items: [
                { label: '5 Euro Pallet (120x80x180)', weight: 150, loadAt: 'CV6 5RD, COVENTRY GB', unloadAt: 'BS11 8AZ, BRISTOL, GB', reqExchange: '5/5', actualExchange: '5', description: 'No description added yet.' },
                { label: '4 Boxes (40x40x40)', weight: 120, loadAt: 'CV6 5RD, COVENTRY GB', unloadAt: 'BS11 8AZ, BRISTOL, GB', description: 'Promotional display units — handle upright, do not stack.' },
              ] } },
          { id: 'ORD-8841938', ref: '#CCA2025-001020.1', customer: 'R&R Ice Cream UK Ltd', expectedPallets: 5, weight: 100, actualPallets: null, palletConfirmed: false, palletMismatch: false,
            instructions: 'Use Gate B for trailers over 13.6m. Report to bay office on arrival. Max dwell time 2 hours.',
            cargo: { totalItems: 4, perishable: 'Perishable', tempSensitive: true, loadingMethod: 'Rear Loading', hazardous: false,
              items: [
                { label: '4 Euro Pallet (120x80x180)', weight: 100, loadAt: 'CV6 5RD, COVENTRY GB', unloadAt: 'BS11 8AZ, BRISTOL, GB', reqExchange: '5/5', actualExchange: '5', description: 'Frozen goods — maintain -18C.' },
              ] } },
        ],
        milestones: pickupStages('07:55', 'Dock 018'),
        exceptions: [],
      },
      {
        id: 'STOP-2', type: 'delivery', location: 'Aldi RDC, Bristol', appointment: '14:30 – 15:30',
        orders: [
          { id: 'ORD-8841937', ref: '#CCA2025-001030.1', customer: 'Freiberger UK Ltd', weight: 270,
            podStatus: 'rejected', podRejectedReason: 'Wrong document — the file doesn\'t relate to this shipment.',
            instructions: 'No double-stack trailers. Max height 4.2m. Use bay 12–18 for chilled goods.',
            cargo: { totalItems: 9, perishable: 'Non Perishable', tempSensitive: false, loadingMethod: 'Side Loading', hazardous: false,
              items: [
                { label: '5 Euro Pallet (120x80x180)', weight: 150, loadAt: 'CV6 5RD, COVENTRY GB', unloadAt: 'BS11 8AZ, BRISTOL, GB', reqExchange: '5/5', actualExchange: '5', description: 'No description added yet.' },
                { label: '4 Boxes (40x40x40)', weight: 120, loadAt: 'CV6 5RD, COVENTRY GB', unloadAt: 'BS11 8AZ, BRISTOL, GB', description: 'Promotional display units — handle upright, do not stack.' },
              ] } },
          { id: 'ORD-8841938', ref: '#CCA2025-001020.1', customer: 'R&R Ice Cream UK Ltd', weight: 100,
            podStatus: 'approved', podRejectedReason: null,
            instructions: 'No double-stack trailers. Max height 4.2m. Use bay 12–18 for chilled goods.',
            cargo: { totalItems: 4, perishable: 'Perishable', tempSensitive: true, loadingMethod: 'Rear Loading', hazardous: false,
              items: [
                { label: '4 Euro Pallet (120x80x180)', weight: 100, loadAt: 'CV6 5RD, COVENTRY GB', unloadAt: 'BS11 8AZ, BRISTOL, GB', reqExchange: '5/5', actualExchange: '5', description: 'Frozen goods — maintain -18C.' },
              ] } },
        ],
        milestones: deliveryStages('14:30'),
        exceptions: [],
      },
    ],
  },
  {
    id: 'TRIP2026-000125',
    activeStopId: 'STOP-3',
    status: 'In Transit',
    contact: { name: 'Sarah Chen', company: 'CtrlChain B.V.' },
    vehicle: 'NL-82-BKZ',
    trailer: '441290',
    references: { 'STOP-3': '441290', 'STOP-4': 'Not Added yet' },
    stops: [
      {
        id: 'STOP-3', type: 'pickup', location: 'Rotterdam Europoort Terminal', appointment: '10:00 – 11:00',
        orders: [
          { id: 'ORD-9920001', ref: '#CCA2025-001045.1', customer: 'Lidl Netherlands BV' },
        ],
        milestones: [
          { id: 'eta', label: 'Pickup ETA', kind: 'eta', status: 'eta', source: null, timestamp: '09:50' },
          { id: 'arrived', label: 'Arrived at pickup', kind: 'auto', status: 'assumed', source: 'automated', timestamp: '10:12' },
          { id: 'loaded', label: 'Cargo loaded', kind: 'auto', status: 'proposed', source: 'automated', timestamp: '11:14' },
          { id: 'departed', label: 'Departed pickup', kind: 'auto', status: 'pending', source: null, timestamp: null },
        ],
        exceptions: [],
      },
      {
        id: 'STOP-4', type: 'delivery', location: 'Lidl DC, Bridgend', appointment: '16:00 – 17:00',
        orders: [
          { id: 'ORD-9920001', ref: '#CCA2025-001045.1', customer: 'Lidl Netherlands BV', podStatus: 'pending', podRejectedReason: null },
        ],
        milestones: deliveryStages('15:45'),
        exceptions: [],
      },
    ],
  },
];

/* Scheduled trips not yet underway — shown collapsed in their own section,
   per Samuel's call that upcoming/scheduled trips get a separate list, not
   a timeline (nothing to act on until they become the active trip). */
const MOCK_UPCOMING_TRIPS = [
  {
    id: 'TRIP2026-000124',
    stops: [
      { type: 'pickup', location: 'Heathrow Cargo Terminal', appointment: '08:00 – 09:00', orders: 2 },
      { type: 'delivery', location: 'Southampton Docks', appointment: '14:00 – 14:30', orders: 2 },
    ],
    date: 'Tomorrow',
    vehicle: 'VX72 YYM',
    trailer: '570859',
    contact: { name: 'Sarah Chen', company: 'CtrlChain B.V.' },
  },
];

/* Read-only — completed trips aren't mutated in this prototype, so these don't
   need a state clone the way scheduledTrips (driver can add to it) does. */
const MOCK_TRIP_HISTORY = [
  {
    id: 'TRIP2026-000098',
    stops: [
      { type: 'pickup', location: 'Dover Freight Village', appointment: '08:00 – 09:00', orders: 2 },
      { type: 'delivery', location: 'Meridian Distribution Centre, Coventry', appointment: '14:00 – 15:00', orders: 2 },
    ],
    date: 'Yesterday',
    completed: true,
    vehicle: 'NL-82-BKZ',
    trailer: '441290',
    contact: { name: 'Sarah Chen', company: 'CtrlChain B.V.' },
  },
];

function buildNotifications() {
  const items = [];
  const dismissed = state.dismissedNotifIds || {};

  state.activeTrips.forEach(trip => {
    const pickup = trip.stops.find(s => s.type === 'pickup');
    const delivery = trip.stops.find(s => s.type === 'delivery');
    const from = pickup ? pickup.location : '?';
    const to = delivery ? delivery.location : '?';
    items.push({ id: `notif-trip-${trip.id}`, type: 'trip-assigned', title: 'New Trip Assigned',
      body: `${trip.id} from ${from} to ${to} is assigned to you. You can start the Order now.`,
      date: 'Today', time: '07:30', read: !!dismissed[`notif-trip-${trip.id}`] });

    trip.stops.forEach(stop => {
      stop.milestones.forEach(m => {
        if (m.status === 'proposed') {
          const nid = `notif-ms-${stop.id}-${m.id}`;
          items.push({ id: nid, type: 'milestone', title: 'Milestone Update',
            body: `${m.label} detected at ${stop.location} — confirm to continue.`,
            date: 'Today', time: m.timestamp || '', read: !!dismissed[nid] });
        }
      });
      stop.orders && stop.orders.forEach(o => {
        if (o.podStatus === 'rejected') {
          const nid = `notif-pod-${o.id}`;
          items.push({ id: nid, type: 'pod-rejected', title: 'POD Rejected',
            body: `Your uploaded POD for ${o.ref} has been rejected.`,
            date: 'This Week', time: '', read: !!dismissed[nid], link: 'Read more' });
        }
      });
      stop.exceptions.forEach((e, i) => {
        const nid = `notif-exc-${stop.id}-${i}`;
        items.push({ id: nid, type: 'exception', title: 'Issue Reported',
          body: `${e.type} reported at ${stop.location}.`,
          date: 'Today', time: '', read: !!dismissed[nid] });
      });
    });
  });

  state.scheduledTrips.forEach(t => {
    const from = t.stops[0] ? t.stops[0].location : '?';
    const to = t.stops[t.stops.length - 1] ? t.stops[t.stops.length - 1].location : '?';
    const nid = `notif-sched-${t.id}`;
    items.push({ id: nid, type: 'trip-assigned', title: 'New Trip Assigned',
      body: `${t.id} from ${from} to ${to} is assigned to you. You can start the Order now.`,
      date: 'This Week', time: '08:00', read: !!dismissed[nid] });
  });

  return items;
}

/* A trip can carry more than one conversation (e.g. a general chat plus a
   one-off route-change thread) — this mirrors the web platform's Centralised
   Conversation model, where each conversation is its own record scoped to an
   entity (here, always a trip) rather than one fixed thread per trip. */
const MOCK_CONVERSATIONS = [
  {
    id: 'CONV-1',
    tripId: 'TRIP2026-000123',
    title: 'Pickup at Meridian DC',
    contact: { name: 'Sarah Chen', company: 'CtrlChain B.V.' },
    messages: [
      { id: 'm1', from: 'system', text: 'Conversation started for TRIP2026-000123', time: '07:30' },
      { id: 'm2', from: 'contact', text: 'Hi Jordan, your pickup at Meridian Distribution Centre is confirmed for 08:00. Head to Dock 018 for pallet exchange.', time: '07:32' },
      { id: 'm3', from: 'driver', text: 'Thanks, on my way. Should arrive around 07:55.', time: '07:35' },
      { id: 'm4', from: 'contact', text: 'The warehouse requires PPE and safety shoes — just a heads up.', time: '07:36' },
      { id: 'm5', from: 'driver', text: 'Noted, I have my gear ready.', time: '07:38' },
      { id: 'm6', from: 'contact', text: 'Quick update — Bay 3 is occupied, please use Bay 5 instead when you arrive.', time: '07:52', unread: true },
    ],
  },
  {
    id: 'CONV-2',
    tripId: 'TRIP2026-000098',
    title: 'Dover pickup coordination',
    contact: { name: 'Sarah Chen', company: 'CtrlChain B.V.' },
    messages: [
      { id: 'h1', from: 'system', text: 'Conversation started for TRIP2026-000098', time: 'Yesterday, 08:00' },
      { id: 'h2', from: 'contact', text: 'Hi Jordan, pickup at Dover Freight Village is confirmed. Gate 2 for your trailer size.', time: 'Yesterday, 08:05' },
      { id: 'h3', from: 'driver', text: 'Arrived at Dover. Slight queue at the gate.', time: 'Yesterday, 09:12' },
      { id: 'h4', from: 'contact', text: 'Thanks for the update. Safe drive to Coventry.', time: 'Yesterday, 09:15' },
    ],
  },
];

const MOCK_GUEST_TRIP = {
  id: 'TRIP2026-000142',
  activeStopId: 'STOP-G1',
  stops: [
    {
      id: 'STOP-G1', type: 'pickup', location: 'Heathrow Cargo Terminal', appointment: '13:00 – 14:00',
      orders: [{ id: 'ORD-9001', ref: 'GT-142' }],
      milestones: (() => {
        const s = pickupStages('12:55');
        s[1].status = 'proposed'; s[1].source = 'automated'; s[1].timestamp = '13:04';
        return s;
      })(),
      exceptions: [],
    },
    {
      id: 'STOP-G2', type: 'delivery', location: 'Southampton Docks', appointment: '16:00 – 17:00',
      orders: [{ id: 'ORD-9001', ref: 'GT-142', podStatus: 'pending', podRejectedReason: null }],
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
  microsoft: {
    label: 'Microsoft', domain: 'login.microsoftonline.com', logo: 'assets/social-microsoft.svg',
    share: 'name, email address, and profile picture',
    accounts: [
      { name: 'Jordan Reyes', email: 'jordan.reyes@outlook.com', initial: 'J', color: '#0078d4' },
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
  'self-reg-social-microsoft': null,
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
  'chat-conversation': null,
  'trip-detail': null,
  'stop-detail': null,
  'stop-instructions': null,
  'order-overview': null,
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
  'nav-chats': 'Conversations',
  'chat-conversation': '',
  'trip-detail': '',
  'stop-detail': '',
  'stop-instructions': 'Stop instructions',
  'order-overview': '',
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
    carrierName: '',
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
    instructionsExpanded: {}, // stopId -> boolean
    tripsTab: 'active', // 'new' | 'active' | 'finished'
    hideSecondActiveTrip: true, // reviewer-only — collapses dashboard to the single-active-trip case; toggle from the sticky
    editingMilestone: null, // { stopId, milestoneId } | null — which timestamp is mid-edit
    tripExpanded: {},       // tripId -> boolean (default: true)
    podSheet: null,         // { tripId, stopId, orderId } | null
    exceptionSheet: null,   // { tripId, stopId } | null
    instructionsSheet: null, // { tripId, stopId } | null
    pushNotification: null,  // { tripId, stopId, text, speaking } | null
    instructionsTts: false,  // true while TTS is playing on the instructions page
    addTripSheet: false,
    activeDetailTripId: null,  // which trip's stop we're viewing in stop-detail
    activeDetailStopId: null,  // which stop we're viewing in stop-detail
    orderCardExpanded: {},     // orderId -> boolean for stop-detail order cards
    orderOverview: null,       // { tripId, stopId, orderId } | null
    orderOverviewItemExpanded: {}, // itemIdx -> boolean for cargo item cards

    conversations: deepClone(MOCK_CONVERSATIONS),
    activeConversationId: null,
    chatInput: '',
    chatSearchQuery: '',
    chatFilter: 'all', // 'all' | 'unread'
    tripConversationsSheet: null, // tripId | null
    newConversationSheet: null, // { tripId } | null

    dismissedNotifIds: {
      'notif-pod-ORD-8841937': true,
      'notif-sched-TRIP2026-000124': true,
    },
    markAllReadDialog: false,

    profileBiometrics: false,
    profileNotifications: true,
    profileTimeFormat12h: true,
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
    const fallback = FLOW_FIRST_ROUTE[state.activeFlow] || 'self-reg-welcome';
    setHash(navHistory.pop() || fallback);
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

  toggleInstructions(stopId) {
    state.instructionsExpanded[stopId] = !state.instructionsExpanded[stopId];
    render();
  },

  confirmMilestone(tripId, stopId, milestoneId) {
    const trip = findActiveTrip(tripId);
    const stop = trip && findStop(trip, stopId);
    if (stop) confirmProposal(trip, stop, milestoneId);
    render();
  },

  confirmAssumed(tripId, stopId, milestoneId) {
    const trip = findActiveTrip(tripId);
    const stop = trip && findStop(trip, stopId);
    if (stop) {
      const m = stop.milestones.find(x => x.id === milestoneId);
      if (m && m.status === 'assumed') m.status = 'confirmed';
    }
    render();
  },

  correctAssumed(tripId, stopId, milestoneId) {
    const trip = findActiveTrip(tripId);
    const stop = trip && findStop(trip, stopId);
    if (stop) {
      const m = stop.milestones.find(x => x.id === milestoneId);
      if (m && m.status === 'assumed') {
        m.status = 'pending';
        m.timestamp = null;
        m.source = null;
      }
    }
    render();
  },

  openTripDetail(tripId) {
    state.activeDetailTripId = tripId;
    TITLES['trip-detail'] = tripId;
    this.nav('trip-detail');
  },

  openStopDetail(tripId, stopId) {
    state.activeDetailTripId = tripId;
    state.activeDetailStopId = stopId;
    state.orderCardExpanded = {};
    const trip = findActiveTrip(tripId);
    const stop = trip && findStop(trip, stopId);
    if (trip && stop) {
      stop.orders.forEach((o, i) => { state.orderCardExpanded[o.id] = i === 0; });
      TITLES['stop-detail'] = trip.id;
    }
    this.nav('stop-detail');
  },

  toggleOrderCard(orderId) {
    state.orderCardExpanded[orderId] = !state.orderCardExpanded[orderId];
    render();
  },

  openOrderOverview(tripId, stopId, orderId) {
    state.orderOverview = { tripId, stopId, orderId };
    state.orderOverviewItemExpanded = { 0: true };
    const trip = findActiveTrip(tripId);
    const stop = trip && findStop(trip, stopId);
    const order = stop && stop.orders.find(o => o.id === orderId);
    TITLES['order-overview'] = order ? 'Order ' + order.ref : 'Order Overview';
    this.nav('order-overview');
  },

  closeOrderOverview() {
    state.orderOverview = null;
    state.orderOverviewItemExpanded = {};
    this.back();
  },

  toggleOrderOverviewItem(idx) {
    state.orderOverviewItemExpanded[idx] = !state.orderOverviewItemExpanded[idx];
    render();
  },

  triggerGeofenceEntry(tripId, stopId) {
    const trip = findActiveTrip(tripId);
    const stop = trip && findStop(trip, stopId);
    if (trip && stop) simulateGeofenceEntry(trip, stop);
    render();
  },

  triggerInstructionsNotification(tripId, stopId) {
    const trip = findActiveTrip(tripId);
    const stop = trip && findStop(trip, stopId);
    if (trip && stop) fireInstructionsNotification(trip, stop);
  },

  triggerGeofenceExit(tripId, stopId) {
    const trip = findActiveTrip(tripId);
    const stop = trip && findStop(trip, stopId);
    if (trip && stop) simulateGeofenceExit(trip, stop);
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
  confirmPalletMatch(tripId, stopId, orderId) {
    const trip = findActiveTrip(tripId);
    const stop = trip && findStop(trip, stopId);
    const order = stop && stop.orders.find(o => o.id === orderId);
    if (order) {
      order.actualPallets = order.expectedPallets;
      order.palletMismatch = false;
      order.palletConfirmed = true;
    }
    this._tryCompletePalletExchange(trip, stop);
    render();
  },

  showPalletMismatch(tripId, stopId, orderId) {
    const trip = findActiveTrip(tripId);
    const stop = trip && findStop(trip, stopId);
    const order = stop && stop.orders.find(o => o.id === orderId);
    if (order) order.palletMismatchEntry = true;
    render();
  },

  cancelPalletMismatch(tripId, stopId, orderId) {
    const trip = findActiveTrip(tripId);
    const stop = trip && findStop(trip, stopId);
    const order = stop && stop.orders.find(o => o.id === orderId);
    if (order) order.palletMismatchEntry = false;
    render();
  },

  confirmPalletCount(tripId, stopId, orderId) {
    const input = document.getElementById(`pallet-input-${orderId}`);
    const trip = findActiveTrip(tripId);
    const stop = trip && findStop(trip, stopId);
    const order = stop && stop.orders.find(o => o.id === orderId);
    if (order && input && input.value !== '') {
      order.actualPallets = parseInt(input.value, 10);
      order.palletMismatch = order.actualPallets !== order.expectedPallets;
      order.palletConfirmed = true;
      order.palletMismatchEntry = false;
    }
    this._tryCompletePalletExchange(trip, stop);
    render();
  },

  _tryCompletePalletExchange(trip, stop) {
    if (stop && stop.orders.every(o => o.palletConfirmed)) {
      const idx = stop.milestones.findIndex(m => m.kind === 'pallet-exchange');
      if (idx >= 0 && stop.milestones[idx].status !== 'confirmed') {
        completeMilestone(trip, stop, idx);
      }
    }
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
    if (m && input) { m.timestamp = input.value || m.timestamp; m.source = 'manual'; }
    state.editingMilestone = null;
    render();
  },

  saveHeroTimestamp(tripId, stopId, milestoneId) {
    const input = document.getElementById(`ts-input-${milestoneId}`);
    const trip = findActiveTrip(tripId);
    const stop = trip && findStop(trip, stopId);
    const m = stop && stop.milestones.find(x => x.id === milestoneId);
    if (m && input) { m.timestamp = input.value || m.timestamp; m.source = 'manual'; }
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
    if (order) {
      order.podStatus = 'uploaded';
      order.podRejectedReason = null;
    }
    if (stop && stop.orders.every(o => o.podStatus === 'uploaded' || o.podStatus === 'approved')) {
      const podIdx = stop.milestones.findIndex(m => m.kind === 'pod');
      if (podIdx >= 0 && stop.milestones[podIdx].status !== 'confirmed') {
        completeMilestone(trip, stop, podIdx);
      }
    }
    state.podSheet = null;
    render();
  },

  openPalletExchangeSheet(tripId, stopId) {
    state.palletExchangeSheet = { tripId, stopId };
    render();
  },

  closePalletExchangeSheet() {
    state.palletExchangeSheet = null;
    render();
  },

  toggleTripExpand(tripId) {
    const current = state.tripExpanded[tripId] !== false;
    state.tripExpanded[tripId] = !current;
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

  openInstructionsSheet(tripId, stopId) {
    state.instructionsSheet = { tripId, stopId };
    state.instructionsTts = false;
    window.speechSynthesis && window.speechSynthesis.cancel();
    this.nav('stop-instructions');
  },

  closeInstructionsSheet() {
    state.instructionsSheet = null;
    state.instructionsTts = false;
    window.speechSynthesis && window.speechSynthesis.cancel();
    this.back();
  },

  toggleInstructionsTts() {
    if (!state.instructionsSheet) return;
    if (state.instructionsTts) {
      state.instructionsTts = false;
      window.speechSynthesis && window.speechSynthesis.cancel();
      render();
      return;
    }
    const trip = findActiveTrip(state.instructionsSheet.tripId);
    const stop = trip && findStop(trip, state.instructionsSheet.stopId);
    if (!stop) return;
    const stopType = stop.type === 'pickup' ? 'pickup' : stop.type === 'delivery' ? 'delivery' : stop.type;
    const text = 'You have a ' + stopType + ' instruction. ' + stop.orders.filter(o => o.instructions).map(o =>
      (o.customer || o.ref) + '. ' + o.instructions.replace(/\n/g, '. ')
    ).join('. Next order. ');
    if (!text) return;
    state.instructionsTts = true;
    render();
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 0.95;
      utter.onend = () => { state.instructionsTts = false; render(); };
      utter.onerror = () => { state.instructionsTts = false; render(); };
      window.speechSynthesis.speak(utter);
    }
  },

  dismissPushNotification() {
    state.pushNotification = null;
    window.speechSynthesis && window.speechSynthesis.cancel();
    render();
  },

  openPushNotification() {
    const notif = state.pushNotification;
    if (!notif) return;
    state.pushNotification = null;
    window.speechSynthesis && window.speechSynthesis.cancel();
    this.openInstructionsSheet(notif.tripId, notif.stopId);
  },

  toggleNotificationTts() {
    const notif = state.pushNotification;
    if (!notif) return;
    if (notif.speaking) {
      notif.speaking = false;
      window.speechSynthesis && window.speechSynthesis.cancel();
      render();
      return;
    }
    notif.speaking = true;
    render();
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(notif.text);
      utter.rate = 0.95;
      utter.onend = () => { if (state.pushNotification) { state.pushNotification.speaking = false; render(); } };
      utter.onerror = () => { if (state.pushNotification) { state.pushNotification.speaking = false; render(); } };
      window.speechSynthesis.speak(utter);
    }
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
      const description = descEl ? descEl.value.trim() : '';
      stop.exceptions.push({
        type: typeLabel,
        orderId: orderEl && orderEl.value !== '__all' ? orderEl.value : null,
        description,
      });

      const now = formatNowTime();
      const stopIdx = trip.stops.indexOf(stop) + 1;
      const convTitle = `Issue: ${typeLabel} — Stop ${stopIdx} ${stop.location}`;
      const driverMsg = description || `Reported: ${typeLabel}`;
      const conv = {
        id: 'conv-exc-' + Date.now(),
        tripId: trip.id,
        title: convTitle,
        contact: trip.contact || { name: 'CtrlChain', company: 'CtrlChain B.V.' },
        messages: [
          { id: 'msg-' + Date.now() + '-sys', from: 'system', text: `Issue reported for ${trip.id} — ${stop.location}`, time: now },
          { id: 'msg-' + Date.now() + '-drv', from: 'driver', text: driverMsg, time: now },
          { id: 'msg-' + Date.now() + '-ack', from: 'contact', text: `Thanks for reporting this. We've logged the ${typeLabel.toLowerCase()} issue and will get back to you shortly.`, time: now, unread: true },
        ],
      };
      state.conversations.unshift(conv);
      state.exceptionSheet = null;
      this.openConversation(conv.id);
      return;
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
        id: ref.toUpperCase(),
        stops: [
          { type: 'pickup', location: 'Awaiting assignment', appointment: 'TBC', orders: 0 },
          { type: 'delivery', location: 'Awaiting assignment', appointment: 'TBC', orders: 0 },
        ],
        date: 'Pending',
      });
    }
    state.addTripSheet = false;
    render();
  },

  /* Bottom tab bar — tabs are sibling top-level destinations. We push the
     current route so that screens opened FROM a tab can "back" into it. */
  goTab(route) {
    const current = currentRoute();
    if (current !== route) navHistory.push(current);
    setHash(route);
  },

  switchTripsTab(tab) {
    state.tripsTab = tab;
    render();
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

  setChatSearch(value) {
    state.chatSearchQuery = value;
    render();
    // render() rebuilds #app from scratch, which would otherwise drop focus
    // out of the search box after every keystroke.
    const input = document.querySelector('.chat-search-input');
    if (input) {
      input.focus();
      const len = input.value.length;
      input.setSelectionRange(len, len);
    }
  },

  setChatFilter(value) {
    state.chatFilter = value;
    render();
  },

  showMarkAllReadDialog() {
    state.markAllReadDialog = true;
    render();
  },
  closeMarkAllReadDialog() {
    state.markAllReadDialog = false;
    render();
  },
  confirmMarkAllRead() {
    buildNotifications().forEach(n => { state.dismissedNotifIds[n.id] = true; });
    state.markAllReadDialog = false;
    render();
  },

  openConversation(conversationId) {
    state.activeConversationId = conversationId;
    state.chatInput = '';
    const conv = state.conversations.find(c => c.id === conversationId);
    if (conv) conv.messages.forEach(m => { m.unread = false; });
    this.nav('chat-conversation');
  },

  setChatInput(value) {
    state.chatInput = value;
  },

  sendChatMessage() {
    const text = state.chatInput.trim();
    if (!text || !state.activeConversationId) return;
    const conv = state.conversations.find(c => c.id === state.activeConversationId);
    if (!conv) return;
    conv.messages.push({
      id: 'msg-' + Date.now(),
      from: 'driver',
      text: text,
      time: formatNowTime(),
    });
    state.chatInput = '';
    render();
    requestAnimationFrame(() => {
      const container = document.querySelector('.chat-messages');
      if (container) container.scrollTop = container.scrollHeight;
    });
  },

  openTripConversationsSheet(tripId) {
    state.tripConversationsSheet = tripId;
    render();
  },

  closeTripConversationsSheet() {
    state.tripConversationsSheet = null;
    render();
  },

  openNewConversationSheet(tripId) {
    state.tripConversationsSheet = null;
    state.newConversationSheet = { tripId };
    render();
  },

  closeNewConversationSheet() {
    state.newConversationSheet = null;
    render();
  },

  submitNewConversation() {
    const { tripId } = state.newConversationSheet;
    const trip = findActiveTrip(tripId);
    const titleEl = document.getElementById('new-convo-title');
    const messageEl = document.getElementById('new-convo-message');
    const title = titleEl && titleEl.value.trim();
    const message = messageEl && messageEl.value.trim();
    if (!title || !trip) { state.newConversationSheet = null; render(); return; }
    const conv = {
      id: 'conv-' + Date.now(),
      tripId: trip.id,
      title,
      contact: trip.contact || { name: 'CtrlChain', company: 'CtrlChain B.V.' },
      messages: [
        { id: 'msg-' + Date.now() + '-sys', from: 'system', text: `Conversation started for ${trip.id}`, time: formatNowTime() },
      ],
    };
    if (message) {
      conv.messages.push({ id: 'msg-' + Date.now() + '-first', from: 'driver', text: message, time: formatNowTime() });
    }
    state.conversations.unshift(conv);
    state.newConversationSheet = null;
    this.openConversation(conv.id);
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

function tripCard(trip) {
  const done = trip.completed;
  const totalStops = trip.stops.length;
  const totalOrders = trip.stops.reduce((sum, s) => sum + (typeof s.orders === 'number' ? s.orders : (s.orders ? s.orders.length : 0)), 0);

  return h`
    <div class="sched-card ${done ? 'sched-card--done' : ''} tl-card--tappable" onclick="App.openTripDetail('${trip.id}')">
      <div class="sched-card__header-line">
        <span class="sched-card__id">${trip.id}</span> • ${totalStops} Stop${totalStops === 1 ? '' : 's'} • ${totalOrders} Order${totalOrders === 1 ? '' : 's'}
      </div>
      <div class="sched-card__body">
        <div class="route-strip route-strip--compact">
          ${trip.stops.map((stop, i) => {
            const isFirst = i === 0;
            const isLast = i === trip.stops.length - 1;
            const label = isFirst ? 'Start' : isLast ? 'End' : 'Stop';
            return h`
              <div class="route-strip__dot-cell">
                <span class="route-stop__dot route-stop__dot--faded"></span>
                ${!isLast ? h`<span class="route-stop__line route-stop__line--faded"></span>` : ''}
              </div>
              <div class="sched-card__stop">
                <div class="sched-card__stop-loc">${stop.location}</div>
                <div class="sched-card__stop-time">${label} (${trip.date || 'Today'}, ${stop.appointment})</div>
              </div>`;
          }).join('')}
        </div>
        <sl-icon name="chevron-right" class="sched-card__chevron"></sl-icon>
      </div>
      <div class="sched-card__divider"></div>
      <div class="sched-card__resources">
        <span class="sched-card__res-item"><span class="sched-card__res-label">Vehicle:</span> ${trip.vehicle || '—'}</span>
        <span class="sched-card__res-item"><span class="sched-card__res-label">Trailer:</span> ${trip.trailer || '—'}</span>
      </div>
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
  return state.activeTrips.find(t => t.id === tripId)
    || state.scheduledTrips.find(t => t.id === tripId)
    || MOCK_TRIP_HISTORY.find(t => t.id === tripId)
    || (state.guestTrip.id === tripId ? state.guestTrip : null);
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

/* V1 cascade model — automation drives progression, driver confirms data.
   Geofence events propose milestones and cascade immediately. Driver
   confirmation validates accuracy (timestamp, correctness) but does NOT
   gate the next stage. This lets the hero card always show the most recent
   automation proposal, and the driver can go back to confirm missed ones.

   Two geofence events per stop:
     entry → proposes arrival, unlocks pallet exchange
     exit  → proposes cargo loaded + departed (same event, same timestamp),
             advances trip to next stop

   Non-automatable stages (POD, pallet exchange) still require driver action.
   completeMilestone() is kept for those internal callers (submitPod,
   _tryCompletePalletExchange) that complete a stage from driver input. */

function confirmProposal(trip, stop, milestoneId) {
  const m = stop.milestones.find(x => x.id === milestoneId);
  if (m && m.status === 'proposed') {
    m.status = 'confirmed';
    if (m.id === 'loaded' || m.id === 'unloaded') {
      const departed = stop.milestones.find(x => x.id === 'departed');
      if (departed && departed.status === 'proposed') {
        departed.status = 'confirmed';
        departed.timestamp = m.timestamp;
      }
      const stopIdx = trip.stops.findIndex(s => s.id === stop.id);
      const nextStop = trip.stops[stopIdx + 1];
      if (nextStop) trip.activeStopId = nextStop.id;
    }
  }
}

function simulateGeofenceEntry(trip, stop) {
  const arrived = stop.milestones.find(m => m.id === 'arrived');
  if (!arrived || arrived.status !== 'pending') return;
  arrived.status = 'proposed';
  arrived.source = 'automated';
  arrived.timestamp = formatNowTime();
  const pe = stop.milestones.find(m => m.kind === 'pallet-exchange');
  if (pe && pe.status === 'pending') pe.status = 'ready';

}

function fireInstructionsNotification(trip, stop) {
  const hasInstructions = stop.orders.some(o => o.instructions);
  if (!hasInstructions) return;
  const preview = stop.orders.filter(o => o.instructions)
    .map(o => o.instructions.split('\n')[0]).join(' | ');
  const stopType = stop.type === 'pickup' ? 'pickup' : stop.type === 'delivery' ? 'delivery' : stop.type;
  const intro = 'You have a ' + stopType + ' instruction.';
  const fullText = intro + ' ' + stop.orders.filter(o => o.instructions).map(o =>
    (o.customer || o.ref) + '. ' + o.instructions.replace(/\n/g, '. ')
  ).join('. Next order. ');
  state.pushNotification = {
    tripId: trip.id, stopId: stop.id,
    text: fullText, intro: intro, preview: preview,
    location: stop.location, speaking: false,
  };
  render();
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(intro);
    utter.rate = 0.95;
    window.speechSynthesis.speak(utter);
  }
}

function simulateGeofenceExit(trip, stop) {
  const loaded = stop.milestones.find(m => m.id === 'loaded' || m.id === 'unloaded');
  const ts = formatNowTime();
  if (loaded && (loaded.status === 'pending' || loaded.status === 'proposed')) {
    loaded.status = 'proposed';
    loaded.source = 'automated';
    loaded.timestamp = ts;
  }
  // departed is auto-confirmed when driver confirms loaded/unloaded (confirmProposal)
  const arrived = stop.milestones.find(m => m.id === 'arrived');
  if (arrived && arrived.status === 'pending') {
    arrived.status = 'proposed';
    arrived.source = 'automated';
    arrived.timestamp = ts;
  }
  const pod = stop.milestones.find(m => m.kind === 'pod');
  if (pod && pod.status === 'pending') pod.status = 'ready';
}

function completeMilestone(trip, stop, index) {
  const m = stop.milestones[index];
  m.status = 'confirmed';
  if (!m.timestamp) m.timestamp = formatNowTime();
  const lastNonPallet = stop.milestones.filter(ms => ms.kind !== 'pallet-exchange').slice(-1)[0];
  if (m.id === lastNonPallet.id) {
    const stopIdx = trip.stops.findIndex(s => s.id === stop.id);
    const nextStop = trip.stops[stopIdx + 1];
    if (nextStop) trip.activeStopId = nextStop.id;
  }
}

function stopInstructionsBlock(stop) {
  const withInstructions = stop.orders.filter(o => o.instructions);
  if (!withInstructions.length) return '';
  const expanded = state.instructionsExpanded && state.instructionsExpanded[stop.id];
  const singleOrder = withInstructions.length === 1;
  return h`
    <div class="stop-instructions">
      <button type="button" class="stop-instructions__toggle" onclick="event.stopPropagation(); App.toggleInstructions('${stop.id}')">
        <sl-icon name="info-circle" style="font-size:14px"></sl-icon>
        <span class="t-label-sm">Instructions</span>
        <span class="t-body-sm t-caption">${withInstructions.length} order${singleOrder ? '' : 's'}</span>
        <sl-icon class="stop-instructions__chevron" name="${expanded ? 'chevron-up' : 'chevron-down'}"></sl-icon>
      </button>
      ${expanded ? h`
        <div class="stop-instructions__body">
          ${withInstructions.map(o => h`
            <div class="stop-instructions__order ${singleOrder ? '' : 'stop-instructions__order--multi'}">
              ${!singleOrder ? h`<div class="stop-instructions__order-header"><span class="t-label-sm">${o.customer || o.ref}</span><span class="t-body-sm t-caption">${o.ref}</span></div>` : ''}
              <div class="stop-instructions__text t-body-sm">${o.instructions.replace(/\n/g, '<br/>')}</div>
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

/* One or more "Active Trip" accordions — the dashboard's main content. Each is
   its own <sl-details>, open by default (see isExpanded above), so a driver can
   collapse a trip to get it out of the way without losing anything else on the
   dashboard. Takes an array so this scales past one truck/trip, even though V1
   never actually has more than one active at a time. */
function activeTripSection(trips) {
  if (!trips.length) {
    return h`
      <div class="empty-state">
        <sl-icon class="empty-state__icon" name="clipboard"></sl-icon>
        <div class="t-body-md t-muted">No active trips</div>
      </div>
    `;
  }
  return trips.map(trip => {
    const activeStop = trip.stops.find(s => s.id === trip.activeStopId) || trip.stops[0];
    const totalStops = trip.stops.length;
    const expanded = state.tripExpanded[trip.id] !== false;
    return h`
      <div class="trip-group">
        <div class="trip-header">
          <div class="trip-header__left">
            <span class="trip-header__id">${trip.id} • ${totalStops} Stop${totalStops === 1 ? '' : 's'}</span>
            <a class="trip-header__link" href="javascript:void(0)" onclick="event.stopPropagation(); App.openTripDetail('${trip.id}')">See trip details</a>
          </div>
          <button type="button" class="trip-header__toggle" onclick="App.toggleTripExpand('${trip.id}')">
            <sl-icon name="${expanded ? 'chevron-up' : 'chevron-down'}" class="trip-header__chevron"></sl-icon>
          </button>
        </div>
        ${heroCard(trip)}
        ${assumedEventsGate(trip)}
        ${expanded ? h`
          <div class="all-stops-label">All Stops</div>
          ${compactRouteStrip(trip)}
          ${unconfirmedProposals(trip)}
          <button type="button" class="report-issue-link" onclick="App.openExceptionSheet('${trip.id}','${activeStop.id}')">
            <sl-icon name="flag" aria-hidden="true"></sl-icon> Report an issue
          </button>
        ` : ''}
      </div>
    `;
  }).join('');
}

function stopTimelineList(trip) {
  return h`<div class="stop-list">${trip.stops.map(stop => stopItem(trip, stop)).join('')}</div>`;
}

function hasPendingPallets(stop) {
  const pe = stop.milestones.find(m => m.kind === 'pallet-exchange');
  return pe && pe.status !== 'pending' && pe.status !== 'confirmed';
}

function stopStatus(stop) {
  const real = stop.milestones.filter(m => m.kind !== 'eta');
  const blocking = real.filter(m => m.kind !== 'pallet-exchange');
  if (blocking.every(m => m.status === 'confirmed' || m.status === 'assumed')) return 'completed';
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
  const isCollapsed = !expanded && status !== 'active';
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
                ${hasPendingPallets(stop) ? h`<span class="badge badge--attention" title="Pallet exchange pending"><sl-icon name="exclamation-circle"></sl-icon> Pallets</span>` : ''}
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
          ${stopInstructionsBlock(stop)}
          <div class="stage-list">${stop.milestones.map(m => stageItem(trip, stop, m)).join('')}</div>
          <button type="button" class="report-issue-link" onclick="App.openExceptionSheet('${trip.id}','${stop.id}')">
            <sl-icon name="flag" aria-hidden="true"></sl-icon> Report an issue with this stop
          </button>
        </div>
      </sl-details>
    </div>
  `;
}

function stageSourceLabel(m) {
  if (m.status === 'assumed') return 'Unverified';
  if (m.source === 'manual') return 'Updated by driver';
  if (m.source === 'automated') return m.kind === 'auto' ? 'Geofence' : 'Automated';
  return '';
}

/* One stage in a stop's lifecycle — see pickupStages()/deliveryStages() for
   the 'eta' | 'auto' | 'pod' | 'pallet-exchange' kinds this renders differently. */
function stageItem(trip, stop, m) {
  const editing = state.editingMilestone && state.editingMilestone.milestoneId === m.id;
  const dotClass = m.status === 'confirmed' ? 'done'
    : m.status === 'assumed' ? 'assumed'
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
  if (!editing && m.status === 'proposed') {
    action = h`<button type="button" class="stage-confirm-btn" onclick="App.confirmMilestone('${trip.id}','${stop.id}','${m.id}')">Confirm</button>`;
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
      ${hasOrderRows && m.status !== 'pending' && !(m.kind === 'pallet-exchange' && m.status === 'confirmed' && !anyPalletMismatch) ? h`<div class="stage-item__sub">${stop.orders.map(o => m.kind === 'pod' ? orderRow(trip, stop, o) : palletExchangeOrderRow(trip, stop, o)).join('')}</div>` : ''}
    </div>
  `;
}

function podStatusLabel(order) {
  switch (order.podStatus) {
    case 'approved': return 'POD approved';
    case 'uploaded': return 'POD under review';
    case 'rejected': return 'POD rejected';
    default: return 'POD not yet uploaded';
  }
}

function orderRow(trip, stop, order) {
  const st = order.podStatus || 'pending';
  const isRejected = st === 'rejected';
  const isDone = st === 'approved';
  const isUploaded = st === 'uploaded';
  return h`
    <div class="order-row ${isRejected ? 'order-row--rejected' : ''}">
      <div class="order-row__label">
        <span class="t-body-sm t-label-md">${order.customer || order.ref}</span>
        <span class="t-body-sm t-caption">${order.ref} · ${podStatusLabel(order)}</span>
        ${isRejected && order.podRejectedReason ? h`<span class="t-body-sm pod-rejected-reason">${order.podRejectedReason}</span>` : ''}
      </div>
      ${isDone
        ? h`<span class="badge badge--success"><sl-icon name="check2"></sl-icon> Approved</span>`
        : isUploaded
          ? h`<span class="badge badge--info"><sl-icon name="clock"></sl-icon> Review</span>`
          : isRejected
            ? h`<sl-button size="small" variant="warning" onclick="App.openPodSheet('${trip.id}','${stop.id}','${order.id}')">Re-upload</sl-button>`
            : h`<sl-button size="small" onclick="App.openPodSheet('${trip.id}','${stop.id}','${order.id}')">Upload POD</sl-button>`}
    </div>
  `;
}

function palletExchangeOrderRow(trip, stop, order) {
  if (order.palletConfirmed) {
    return h`
      <div class="order-row order-row--confirmed">
        <div class="order-row__label">
          <span class="t-body-sm t-label-md">${order.customer || order.ref}</span>
          <span class="t-body-sm t-caption">${order.ref} · ${order.palletMismatch ? `${order.actualPallets} of ${order.expectedPallets} pallets` : `${order.expectedPallets} pallets`}</span>
        </div>
        ${order.palletMismatch
          ? h`<span class="badge badge--warning"><sl-icon name="exclamation-triangle"></sl-icon> Mismatch</span>`
          : h`<span class="badge badge--success"><sl-icon name="check2"></sl-icon></span>`}
      </div>
    `;
  }
  if (order.palletMismatchEntry) {
    return h`
      <div class="order-row order-row--stacked">
        <div class="order-row__label">
          <span class="t-body-sm t-label-md">${order.customer || order.ref}</span>
          <span class="t-body-sm t-caption">${order.ref} · Expected ${order.expectedPallets} — enter actual count</span>
        </div>
        <div class="order-row__pallet-entry">
          <sl-input id="pallet-input-${order.id}" class="pallet-count-input" type="number" size="small" placeholder="Actual count"></sl-input>
          <sl-button size="small" onclick="App.cancelPalletMismatch('${trip.id}','${stop.id}','${order.id}')">Back</sl-button>
          <sl-button size="small" variant="primary" onclick="App.confirmPalletCount('${trip.id}','${stop.id}','${order.id}')">Confirm</sl-button>
        </div>
      </div>
    `;
  }
  return h`
    <div class="order-row">
      <div class="order-row__label">
        <span class="t-body-sm t-label-md">${order.customer || order.ref}</span>
        <span class="t-body-sm t-caption">${order.ref} · Expected ${order.expectedPallets} pallets</span>
      </div>
      <div class="order-row__pallet-actions">
        <button type="button" class="stage-confirm-btn" onclick="App.confirmPalletMatch('${trip.id}','${stop.id}','${order.id}')">Confirm</button>
        <button type="button" class="pallet-mismatch-link" onclick="App.showPalletMismatch('${trip.id}','${stop.id}','${order.id}')">Mismatch?</button>
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
    <sl-drawer id="pod-drawer" label="${open && order && order.podStatus === 'rejected' ? 'Re-upload POD' : 'Upload POD'}" placement="bottom" ${open ? 'open' : ''}>
      ${open ? h`
        <div class="sheet-body">
          <div class="t-body-sm t-muted">${order.customer || order.ref} (${order.ref}) &middot; ${stop.location}</div>
          ${order.podStatus === 'rejected' && order.podRejectedReason ? h`
            <div class="pod-rejection-banner">
              <sl-icon name="exclamation-triangle" style="font-size:16px;color:var(--color-warning-600,#e65100);"></sl-icon>
              <div>
                <div class="t-label-sm" style="color:var(--color-warning-700,#e65100);">Rejected</div>
                <div class="t-body-sm">${order.podRejectedReason}</div>
              </div>
            </div>
          ` : ''}
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
          <sl-button style="flex:1;" variant="primary" onclick="App.submitPod()">${order.podStatus === 'rejected' ? 'Re-upload POD' : 'Submit POD'}</sl-button>
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
                ${stop.orders.map(o => h`<sl-option value="${o.id}">${o.customer || o.ref} (${o.ref})</sl-option>`).join('')}
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

function instructionsPageContent() {
  if (!state.instructionsSheet) return h`<div class="empty-state"><sl-icon name="info-circle" style="font-size:32px"></sl-icon><p>No instructions selected.</p></div>`;
  const trip = findActiveTrip(state.instructionsSheet.tripId);
  const stop = trip && findStop(trip, state.instructionsSheet.stopId);
  if (!stop) return h`<div class="empty-state"><p>Stop not found.</p></div>`;
  const orders = stop.orders.filter(o => o.instructions);
  const stopIdx = trip.stops.indexOf(stop);
  const speaking = state.instructionsTts;
  return h`
    <div class="instructions-page">
      <div class="instructions-page__header">
        <div class="instructions-page__location">
          <sl-icon name="geo-alt" style="font-size:16px; color:var(--text-secondary)"></sl-icon>
          <span>Stop ${stopIdx + 1}: ${stop.type === 'pickup' ? 'Pickup' : 'Delivery'}</span>
        </div>
        <div class="instructions-page__addr">${stop.location}</div>
      </div>
      <button type="button" class="instructions-tts-btn ${speaking ? 'instructions-tts-btn--active' : ''}" onclick="App.toggleInstructionsTts()">
        <sl-icon name="${speaking ? 'pause-circle' : 'play-circle'}" style="font-size:20px"></sl-icon>
        <span>${speaking ? 'Stop listening' : 'Listen to instructions'}</span>
      </button>
      <div class="instructions-page__list">
        ${orders.length ? orders.map(o => h`
          <div class="instructions-page__item">
            <div class="instructions-page__customer">${o.customer || o.ref}</div>
            <div class="instructions-page__text">${o.instructions.replace(/\n/g, '<br/>')}</div>
          </div>
        `).join('') : h`
          <div class="t-body-sm t-muted" style="padding:24px 0; text-align:center;">No special instructions for this stop.</div>
        `}
      </div>
    </div>
  `;
}

function pushNotificationBanner() {
  const notif = state.pushNotification;
  if (!notif) return '';
  return h`
    <div class="push-notif" onclick="App.openPushNotification()">
      <div class="push-notif__header">
        <div class="push-notif__app">
          <img src="assets/logo-icon.svg" class="push-notif__icon" alt="" />
          <span class="push-notif__app-name">CCA Driver</span>
          <span class="push-notif__time">now</span>
        </div>
        <button type="button" class="push-notif__dismiss" onclick="event.stopPropagation(); App.dismissPushNotification()" aria-label="Dismiss">&times;</button>
      </div>
      <div class="push-notif__title">Stop instructions available</div>
      <div class="push-notif__body">${notif.location} — Tap to view full instructions</div>
      <div class="push-notif__actions">
        <button type="button" class="push-notif__action" onclick="event.stopPropagation(); App.toggleNotificationTts()">
          <sl-icon name="${notif.speaking ? 'pause-fill' : 'volume-up-fill'}" style="font-size:14px"></sl-icon>
          ${notif.speaking ? 'Stop' : 'Listen'}
        </button>
        <button type="button" class="push-notif__action" onclick="event.stopPropagation(); App.openPushNotification()">
          <sl-icon name="box-arrow-up-right" style="font-size:14px"></sl-icon>
          Open
        </button>
      </div>
    </div>
  `;
}

function palletExchangeSheetMarkup() {
  const open = !!state.palletExchangeSheet;
  let trip = null, stop = null;
  if (open) {
    trip = findActiveTrip(state.palletExchangeSheet.tripId);
    stop = trip && findStop(trip, state.palletExchangeSheet.stopId);
  }
  const orders = stop ? stop.orders.filter(o => o.expectedPallets != null) : [];
  const allDone = orders.length > 0 && orders.every(o => o.palletConfirmed);
  return h`
    <sl-drawer id="pallet-exchange-drawer" label="Confirm Pallet Exchange" placement="bottom" ${open ? 'open' : ''}>
      ${open ? h`
        <div class="pex-sheet">
          <div class="pex-sheet__summary t-body-sm t-muted">${stop.location}</div>
          <div class="pex-sheet__cards">
            ${orders.map(order => {
              if (order.palletConfirmed) {
                const countLabel = `${order.actualPallets} of ${order.expectedPallets} Pallets Exchanged`;
                return h`
                  <div class="pex-card pex-card--done">
                    <div class="pex-card__header">
                      <span class="pex-card__customer t-label-md">${order.customer || order.ref} (${order.ref})</span>
                    </div>
                    <div class="pex-card__body">
                      <span class="pex-card__count t-body-sm">${countLabel}</span>
                      ${order.palletMismatch
                        ? h`<span class="pex-badge pex-badge--mismatch"><sl-icon name="exclamation-triangle"></sl-icon> Mismatch</span>`
                        : h`<span class="pex-badge pex-badge--match">Match</span>`}
                    </div>
                  </div>
                `;
              }
              if (order.palletMismatchEntry) {
                return h`
                  <div class="pex-card pex-card--entry">
                    <div class="pex-card__header">
                      <span class="pex-card__customer t-label-md">${order.customer || order.ref} (${order.ref})</span>
                    </div>
                    <div class="pex-card__body pex-card__body--stacked">
                      <span class="pex-card__expected t-label-md">Expected ${order.expectedPallets} Pallets</span><span class="pex-card__count t-body-sm"> — enter actual count</span>
                      <div class="pex-card__input-row">
                        <sl-input id="pallet-input-${order.id}" class="pex-card__input" type="number" size="small" placeholder="Actual count"></sl-input>
                        <button type="button" class="pex-card__action-btn pex-card__action-btn--mismatch" onclick="App.cancelPalletMismatch('${trip.id}','${stop.id}','${order.id}')">Back</button>
                        <button type="button" class="pex-card__confirm-btn" onclick="App.confirmPalletCount('${trip.id}','${stop.id}','${order.id}')">Confirm</button>
                      </div>
                    </div>
                  </div>
                `;
              }
              return h`
                <div class="pex-card">
                  <div class="pex-card__header">
                    <span class="pex-card__customer t-label-md">${order.customer || order.ref} (${order.ref})</span>
                  </div>
                  <div class="pex-card__body pex-card__body--stacked">
                    <span class="pex-card__expected t-label-md">Expected ${order.expectedPallets} Pallets</span>
                    <div class="pex-card__actions">
                      <button type="button" class="pex-card__action-btn pex-card__action-btn--confirm" onclick="App.confirmPalletMatch('${trip.id}','${stop.id}','${order.id}')">Confirm</button>
                      <button type="button" class="pex-card__action-btn pex-card__action-btn--mismatch" onclick="App.showPalletMismatch('${trip.id}','${stop.id}','${order.id}')">Mismatch?</button>
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
        <div slot="footer">
          <sl-button style="width:100%;" onclick="App.closePalletExchangeSheet()">${allDone ? 'Done' : 'Close'}</sl-button>
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

function tripConversationsSheetMarkup() {
  const tripId = state.tripConversationsSheet;
  if (!tripId) return '';
  const convos = conversationsForTrip(tripId);
  const totalUnread = convos.reduce((n, c) => n + conversationUnreadCount(c), 0);
  return h`
    <sl-drawer id="trip-conversations-drawer" label="Conversations" placement="bottom" open>
      <div class="sheet-body" style="padding-bottom:8px;">
        ${convos.length ? convos.map(conv => {
          const msgs = conv.messages.filter(m => m.from !== 'system');
          const last = msgs[msgs.length - 1];
          const unread = conversationUnreadCount(conv);
          return h`
            <button type="button" class="td__convo-row" onclick="App.closeTripConversationsSheet(); App.openConversation('${conv.id}')">
              <div class="td__convo-row__body">
                <div class="td__convo-row__title t-label-sm">${conv.title}</div>
                <div class="td__convo-row__preview t-body-sm t-muted">${last ? (last.from === 'driver' ? 'You: ' : '') + last.text : ''}</div>
              </div>
              ${unread ? h`<span class="chat-row__unread">${unread}</span>` : ''}
              <sl-icon name="chevron-right" class="td__convo-row__chevron"></sl-icon>
            </button>`;
        }).join('') : h`
          <div class="t-body-sm t-muted" style="text-align:center; padding:16px 0;">No conversations yet for this trip.</div>
        `}
      </div>
      <div slot="footer">
        <button type="button" class="btn btn-primary" style="width:100%;" onclick="App.openNewConversationSheet('${tripId}')">
          <sl-icon name="plus-lg" style="font-size:14px;margin-right:6px;"></sl-icon> New conversation
        </button>
      </div>
    </sl-drawer>
  `;
}

/* Scoped-down version of the web platform's "New Conversation" modal — a
   driver only ever starts a conversation about one of their own trips, so
   Type/Reference/Chat With are fixed rather than the web's free-form
   selects (Type=Trip, Reference=this trip, Chat With=the trip's CtrlChain
   contact) and only Title + first message need input. */
function newConversationSheetMarkup() {
  const open = !!state.newConversationSheet;
  const trip = open ? findActiveTrip(state.newConversationSheet.tripId) : null;
  const contact = (trip && trip.contact) || { name: 'CtrlChain', company: 'CtrlChain B.V.' };
  return h`
    <sl-drawer id="new-conversation-drawer" label="New Conversation" placement="bottom" ${open ? 'open' : ''}>
      ${open && trip ? h`
        <div class="sheet-body">
          <div class="sheet-field">
            <label class="t-label-sm">Type</label>
            <sl-input value="Trips" disabled></sl-input>
          </div>
          <div class="sheet-field">
            <label class="t-label-sm">Reference Number</label>
            <sl-input value="${trip.id}" disabled></sl-input>
          </div>
          <div class="sheet-field">
            <label class="t-label-sm">Chat With</label>
            <sl-input value="${contact.company}" disabled></sl-input>
          </div>
          <div class="sheet-field">
            <label class="t-label-sm">Title</label>
            <sl-input id="new-convo-title" placeholder="e.g. Pickup change at Meridian"></sl-input>
          </div>
          <div class="sheet-field">
            <label class="t-label-sm">Message</label>
            <sl-textarea id="new-convo-message" rows="3" placeholder="Type your message here"></sl-textarea>
          </div>
        </div>
        <div slot="footer" style="display:flex; gap:8px;">
          <sl-button style="flex:1;" onclick="App.closeNewConversationSheet()">Cancel</sl-button>
          <sl-button style="flex:1;" variant="primary" onclick="App.submitNewConversation()">Send</sl-button>
        </div>
      ` : ''}
    </sl-drawer>
  `;
}

/* ---------- Hero card, stepper, route strip (V1 dashboard redesign) ----------
   The dashboard no longer inlines the full milestone timeline. Instead:
   1. Hero card — most recent automation proposal (or manual action needed)
   2. Horizontal stepper — trip-level progress at a glance
   3. Compact route strip — stops as tappable rows, detail behind a tap
   4. Unconfirmed proposals — missed confirmations the driver can revisit */

function getHeroState(trip) {
  const proposals = [];
  const manualActions = [];
  trip.stops.forEach(stop => {
    stop.milestones.forEach(m => {
      if (m.status === 'proposed') proposals.push({ milestone: m, stop });
      if (m.status === 'ready') manualActions.push({ milestone: m, stop });
    });
  });
  if (proposals.length) {
    const latest = proposals[proposals.length - 1];
    const unconfirmed = proposals.slice(0, -1);
    return { type: 'proposal', current: latest, unconfirmed, manualActions };
  }
  if (manualActions.length) {
    return { type: 'manual', current: manualActions[0], unconfirmed: [], manualActions };
  }
  const allDone = trip.stops.every(s =>
    s.milestones.filter(m => m.kind !== 'pallet-exchange').every(m => m.status === 'confirmed' || m.status === 'assumed')
  );
  if (allDone) return { type: 'complete', current: null, unconfirmed: [], manualActions: [] };
  const activeStop = trip.stops.find(s => s.id === trip.activeStopId) || trip.stops[0];
  const arrivedM = activeStop.milestones.find(m => m.id === 'arrived');
  const loadedM = activeStop.milestones.find(m => m.id === 'loaded' || m.id === 'unloaded');
  if (arrivedM && arrivedM.status === 'confirmed' && (!loadedM || loadedM.status === 'pending')) {
    return { type: 'arrived', current: { stop: activeStop, milestone: arrivedM }, unconfirmed: [], manualActions };
  }
  return { type: 'info', current: { stop: activeStop, milestone: null }, unconfirmed: [], manualActions };
}

function heroTripContext(trip, stop) {
  const stopIdx = stop ? trip.stops.indexOf(stop) + 1 : 0;
  const totalStops = trip.stops.length;
  const stopType = stop ? (stop.type === 'pickup' ? 'Pickup' : 'Delivery') : '';
  return stopType
    ? `${trip.id} • ${stopType} • Stop ${stopIdx} of ${totalStops}`
    : trip.id;
}

function heroCard(trip) {
  const hero = getHeroState(trip);
  if (hero.type === 'proposal') {
    const { milestone: m, stop } = hero.current;
    const stopIdx = trip.stops.indexOf(stop) + 1;
    const totalStops = trip.stops.length;
    const eventMap = {
      arrived: stop.type === 'pickup' ? 'Arrival at pickup' : 'Arrival at delivery',
      loaded: 'Cargo loaded',
      unloaded: 'Cargo unloaded',
    };
    const eventLabel = eventMap[m.id] || m.label;
    const source = stageSourceLabel(m) || 'Geofence';
    return h`
      <div class="hero-card hero-card--action">
        <div class="hero-card__top">
          <div class="hero-card__eyebrow"><sl-icon name="broadcast" style="font-size:14px"></sl-icon> Tracking update</div>
        </div>
        ${progressBar(trip)}
        <div class="hero-card__update">
          <div class="hero-card__content-block">
            <div class="hero-card__title"><strong>Stop ${stopIdx} of ${totalStops}:</strong> ${eventLabel} detected</div>
            <div class="hero-card__sub">${stop.location}</div>
            <div class="hero-card__timestamp-row">
              <span class="hero-card__chip">At: <strong>${m.timestamp}</strong></span>
              <span class="hero-card__source">• ${source}</span>
            </div>
          </div>
          ${state.editingMilestone && state.editingMilestone.milestoneId === m.id
            ? h`<div class="hero-card__edit-row">
                <sl-input id="ts-input-${m.id}" type="time" size="small" value="${m.timestamp || ''}" class="hero-card__time-input"></sl-input>
                <button type="button" class="hero-card__cta" onclick="App.saveHeroTimestamp('${trip.id}','${hero.current.stop.id}','${m.id}')">Save</button>
                <button type="button" class="hero-card__edit" onclick="App.cancelEditTimestamp()">Cancel</button>
              </div>`
            : h`<div class="hero-card__actions">
                <button type="button" class="hero-card__cta" onclick="App.confirmMilestone('${trip.id}','${hero.current.stop.id}','${m.id}')">Looks right!</button>
                <button type="button" class="hero-card__edit" onclick="App.startEditTimestamp('${hero.current.stop.id}','${m.id}')">Edit time</button>
              </div>`
          }
        </div>
      </div>
    `;
  }
  if (hero.type === 'manual') {
    const { milestone: m, stop } = hero.current;
    const stopIdx = trip.stops.indexOf(stop) + 1;
    const totalStops = trip.stops.length;
    const isPod = m.kind === 'pod';
    const isPallet = m.kind === 'pallet-exchange';
    const ordersLeft = isPod ? stop.orders.filter(o => o.podStatus !== 'approved' && o.podStatus !== 'uploaded').length
      : isPallet ? stop.orders.filter(o => !o.palletConfirmed).length : 0;
    const label = isPod ? 'Upload POD' : isPallet ? 'Pallet exchange needed' : m.label;
    const detail = isPod ? `${ordersLeft} Order${ordersLeft === 1 ? '' : 's'} remaining`
      : isPallet ? `${ordersLeft} Order${ordersLeft === 1 ? '' : 's'} to confirm` : '';
    return h`
      <div class="hero-card hero-card--manual">
        <div class="hero-card__top">
          <div class="hero-card__eyebrow"><sl-icon name="exclamation-triangle" style="font-size:14px"></sl-icon> Action needed</div>
        </div>
        ${progressBar(trip)}
        <div class="hero-card__update">
          <div class="hero-card__content-block">
            <div class="hero-card__title hero-card__title--bold">Stop ${stopIdx} of ${totalStops}: ${label}</div>
            <div class="hero-card__sub">${stop.location}</div>
          </div>
          ${detail ? h`<div class="hero-card__meta-row"><span class="hero-card__chip hero-card__chip--orders"><strong>${detail}</strong></span></div>` : ''}
          <div class="hero-card__actions">
            <button type="button" class="hero-card__cta hero-card__cta--secondary" onclick="${isPallet ? `App.openPalletExchangeSheet('${trip.id}','${stop.id}')` : `App.openStopDetail('${trip.id}','${stop.id}')`}">View details</button>
          </div>
        </div>
      </div>
    `;
  }
  if (hero.type === 'complete') {
    return h`
      <div class="hero-card hero-card--complete">
        <div class="hero-card__top">
          <div class="hero-card__eyebrow"><sl-icon name="check-circle" style="font-size:14px"></sl-icon> Trip complete</div>
        </div>
        ${progressBar(trip)}
        <div class="hero-card__update">
          <div class="hero-card__title hero-card__title--bold">All milestones confirmed</div>
        </div>
      </div>
    `;
  }
  if (hero.type === 'arrived') {
    const { milestone: m, stop } = hero.current;
    const stopIdx = trip.stops.indexOf(stop) + 1;
    const totalStops = trip.stops.length;
    const eventLabel = stop.type === 'pickup' ? 'Arrival at pickup' : 'Arrival at delivery';
    const source = stageSourceLabel(m) || 'Geofence';
    return h`
      <div class="hero-card hero-card--action">
        <div class="hero-card__top">
          <div class="hero-card__eyebrow"><sl-icon name="broadcast" style="font-size:14px"></sl-icon> Tracking update</div>
        </div>
        ${progressBar(trip)}
        <div class="hero-card__update">
          <div class="hero-card__content-block">
            <div class="hero-card__title"><strong>Stop ${stopIdx} of ${totalStops}:</strong> ${eventLabel} detected</div>
            <div class="hero-card__sub">${stop.location}</div>
            <div class="hero-card__timestamp-row">
              <span class="hero-card__chip">At: <strong>${m.timestamp}</strong></span>
              <span class="hero-card__source">• ${source}</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }
  const stop = hero.current.stop;
  const stopIdx = trip.stops.indexOf(stop) + 1;
  const totalStops = trip.stops.length;
  const eta = stop.milestones.find(m => m.kind === 'eta');
  return h`
    <div class="hero-card hero-card--info">
      <div class="hero-card__top">
        <div class="hero-card__eyebrow"><sl-icon name="truck" style="font-size:14px"></sl-icon> En route</div>
      </div>
      ${progressBar(trip)}
      <div class="hero-card__update">
        <div class="hero-card__content-block">
          <div class="hero-card__title"><strong>Stop ${stopIdx} of ${totalStops}:</strong> Heading to ${stop.type === 'pickup' ? 'pickup' : 'delivery'}</div>
          <div class="hero-card__sub">${stop.location}</div>
        </div>
        ${eta ? h`
          <div class="hero-card__meta-block">
            <div class="hero-card__window-row"><span>Window:</span> <span>Today, ${stop.appointment}</span></div>
            <div class="hero-card__timestamp-row">
              <span class="hero-card__chip">ETA at: <strong>${eta.timestamp}</strong></span>
              <span class="hero-card__source">• System Calculated</span>
            </div>
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

function tripStepperPhase(trip) {
  const pickup = trip.stops.find(s => s.type === 'pickup');
  const delivery = trip.stops.find(s => s.type === 'delivery');
  const pickupDeparted = pickup && pickup.milestones.find(m => m.id === 'departed');
  const pickupArrived = pickup && pickup.milestones.find(m => m.id === 'arrived');
  const deliveryArrived = delivery && delivery.milestones.find(m => m.id === 'arrived');
  const deliveryDeparted = delivery && delivery.milestones.find(m => m.id === 'departed');
  if (deliveryDeparted && deliveryDeparted.status !== 'pending') return 4;
  if (deliveryArrived && deliveryArrived.status !== 'pending') return 3;
  if (pickupDeparted && pickupDeparted.status !== 'pending') return 2;
  if (pickupArrived && pickupArrived.status !== 'pending') return 1;
  return 0;
}

function progressBar(trip) {
  const phase = tripStepperPhase(trip);
  const segments = 5;
  return h`
    <div class="progress-bar">
      ${Array.from({ length: segments }, (_, i) => {
        const cls = i < phase ? 'progress-bar__seg--done'
          : i === phase ? 'progress-bar__seg--current' : '';
        return h`<span class="progress-bar__seg ${cls}"></span>`;
      }).join('')}
    </div>
  `;
}

function compactRouteStrip(trip) {
  return h`
    <div class="route-strip">
      ${trip.stops.map((stop, i) => {
        const isLast = i === trip.stops.length - 1;
        const orderCount = stop.orders.length;
        const hasInstructions = stop.orders.some(o => o.instructions);
        return h`
          <div class="route-strip__dot-cell">
            <span class="route-stop__dot"></span>
            ${!isLast ? h`<span class="route-stop__line"></span>` : ''}
          </div>
          <div class="route-stop-card">
            <div class="route-stop-card__content">
              <div class="route-stop-card__title-row">
                <span class="route-stop-card__loc">Stop ${i + 1}: ${stop.type === 'pickup' ? 'Pickup' : 'Delivery'}</span>
                <span class="route-stop-card__badge">${orderCount} Order${orderCount === 1 ? '' : 's'}</span>
              </div>
              <div class="route-stop-card__addr">${stop.location}</div>
              <div class="route-stop-card__meta">Window: Today, ${stop.appointment}</div>
            </div>
            <div class="stop-btn-row">
              <button type="button" class="stop-btn" onclick="App.openStopDetail('${trip.id}','${stop.id}')">Stop details</button>
              <button type="button" class="stop-btn ${hasInstructions ? '' : 'stop-btn--disabled'}" onclick="${hasInstructions ? `App.openInstructionsSheet('${trip.id}','${stop.id}')` : 'void(0)'}" ${hasInstructions ? '' : 'disabled'}>Read Instructions</button>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function unconfirmedProposals(trip) {
  const all = [];
  trip.stops.forEach((stop, idx) => {
    stop.milestones.forEach(m => {
      if (m.status === 'proposed') all.push({ milestone: m, stop, stopIndex: idx });
    });
  });
  if (all.length <= 1) return '';
  const missed = all.slice(0, -1);
  const grouped = {};
  missed.forEach(item => {
    if (!grouped[item.stop.id]) grouped[item.stop.id] = { stop: item.stop, stopIndex: item.stopIndex, milestones: [] };
    grouped[item.stop.id].milestones.push(item.milestone);
  });
  const groups = Object.values(grouped);
  return h`
    <div class="unconfirmed-list">
      <div class="unconfirmed-list__header">
        <sl-icon name="clock-history" style="font-size:14px"></sl-icon>
        <span class="t-label-sm">${missed.length} unconfirmed</span>
      </div>
      ${groups.map(group => h`
        <div class="unconfirmed-group__label">
          <span class="t-label-sm">Stop ${group.stopIndex + 1}: ${group.stop.type === 'pickup' ? 'Pickup' : 'Delivery'} — ${group.stop.location}</span>
        </div>
        ${group.milestones.map(m => h`
          <div class="unconfirmed-row">
            <div class="unconfirmed-row__info">
              <span class="t-body-sm">${m.label}</span>
              <span class="t-body-sm t-caption">${m.timestamp} · ${stageSourceLabel(m) || 'Automated'}</span>
            </div>
            <div class="unconfirmed-row__actions">
              <button type="button" class="unconfirmed-row__btn" onclick="App.confirmMilestone('${trip.id}','${group.stop.id}','${m.id}')">Confirm</button>
            </div>
          </div>
        `).join('')}
      `).join('')}
    </div>
  `;
}

function assumedEventsGate(trip) {
  const assumed = [];
  trip.stops.forEach(stop => {
    stop.milestones.forEach(m => {
      if (m.status === 'assumed') assumed.push({ milestone: m, stop });
    });
  });
  if (!assumed.length) return '';
  return assumed.map(({ milestone: m, stop }) => {
    const eventMap = {
      arrived: stop.type === 'pickup' ? 'arrival at pickup' : 'arrival at delivery',
      departed: stop.type === 'pickup' ? 'departure from pickup' : 'departure from delivery',
    };
    const eventLabel = eventMap[m.id] || m.label;
    return h`
      <div class="assumed-gate">
        <div class="assumed-gate__header">
          <sl-icon name="exclamation-triangle" style="font-size:14px"></sl-icon>
          Unverified ${eventLabel}
        </div>
        <div class="assumed-gate__text">
          We detected your <strong>${eventLabel}</strong> at <strong>${stop.location}</strong> at <strong>${m.timestamp}</strong>, but you didn't confirm. Is this correct?
        </div>
        <div class="assumed-gate__actions">
          <button type="button" class="assumed-gate__btn assumed-gate__btn--confirm" onclick="App.confirmAssumed('${trip.id}','${stop.id}','${m.id}')">Yes, I arrived</button>
          <button type="button" class="assumed-gate__btn assumed-gate__btn--correct" onclick="App.correctAssumed('${trip.id}','${stop.id}','${m.id}')">No, wasn't there</button>
        </div>
      </div>
    `;
  }).join('');
}

/* ── TRIP DETAIL ─────────────────────────────────────────────────────── */

function tripStopStatus(trip, stop) {
  if (trip.completed) return 'Finished';
  const idx = trip.stops.indexOf(stop);
  const activeIdx = trip.stops.findIndex(s => s.id === trip.activeStopId);
  if (activeIdx === -1) return 'Not Started';
  if (idx < activeIdx) return 'Finished';
  if (idx === activeIdx) return 'In Transit';
  return 'Not Started';
}

function buildRouteMapSvg(trip) {
  const W = 360, H = 170, pad = 30;
  const stops = trip.stops || [];
  const n = stops.length;
  if (n === 0) return '';

  const MAP_COORDS = {
    'Meridian Distribution Centre, Coventry': { x: 0.55, y: 0.35 },
    'Aldi RDC, Bristol':                      { x: 0.30, y: 0.55 },
    'Rotterdam Europoort Terminal':            { x: 0.75, y: 0.25 },
    'Lidl DC, Bridgend':                      { x: 0.22, y: 0.60 },
    'Heathrow Cargo Terminal':                 { x: 0.58, y: 0.50 },
    'Southampton Docks':                       { x: 0.50, y: 0.65 },
    'Dover Freight Village':                   { x: 0.72, y: 0.55 },
  };

  const pts = stops.map((s, i) => {
    const c = MAP_COORDS[s.location];
    if (c) return { x: pad + c.x * (W - pad * 2), y: pad + c.y * (H - pad * 2) };
    const t = n > 1 ? i / (n - 1) : 0.5;
    return { x: pad + t * (W - pad * 2), y: H * 0.45 + Math.sin(t * Math.PI) * 20 };
  });

  const isDark = document.documentElement.classList.contains('dark');
  const landFill   = isDark ? '#2a3040' : '#e8ecf0';
  const landStroke = isDark ? '#3a4258' : '#c8cdd5';
  const waterFill  = isDark ? '#1a2030' : '#dae3f0';
  const routeColor = isDark ? '#7a9a5a' : '#4a6e3a';
  const markerBg   = isDark ? '#3a4050' : '#f5f5f5';
  const markerBorder = isDark ? '#606878' : '#b0b4bc';
  const markerText = isDark ? '#e0e2e8' : '#333';
  const roadColor  = isDark ? '#404858' : '#d0d4da';
  const cityDot    = isDark ? '#505868' : '#bcc0c8';
  const cityText   = isDark ? '#606878' : '#a0a4ac';
  const cursorFill = isDark ? '#5599ee' : '#2266cc';

  let pathD = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1], curr = pts[i];
    const cpx1 = prev.x + (curr.x - prev.x) * 0.4;
    const cpy1 = prev.y - 10;
    const cpx2 = prev.x + (curr.x - prev.x) * 0.6;
    const cpy2 = curr.y + 10;
    pathD += ` C ${cpx1} ${cpy1}, ${cpx2} ${cpy2}, ${curr.x} ${curr.y}`;
  }

  const cities = [
    { name: 'London',     x: 0.56, y: 0.46 },
    { name: 'Birmingham', x: 0.48, y: 0.28 },
    { name: 'Cardiff',    x: 0.26, y: 0.52 },
    { name: 'Manchester', x: 0.44, y: 0.12 },
    { name: 'Leeds',      x: 0.52, y: 0.10 },
  ];
  const citiesSvg = cities.map(c => {
    const cx = pad + c.x * (W - pad * 2);
    const cy = pad + c.y * (H - pad * 2);
    return `<circle cx="${cx}" cy="${cy}" r="1.5" fill="${cityDot}"/>
            <text x="${cx + 4}" y="${cy + 1}" fill="${cityText}" font-size="6" font-family="Roboto,sans-serif">${c.name}</text>`;
  }).join('');

  const roads = [
    'M 30,80 Q 100,70 170,65 Q 240,60 320,55',
    'M 170,30 Q 175,60 180,95 Q 185,120 190,145',
    'M 80,40 Q 130,50 180,65 Q 230,75 280,60',
  ];
  const roadsSvg = roads.map(d =>
    `<path d="${d}" fill="none" stroke="${roadColor}" stroke-width="0.8" stroke-dasharray="3,3" opacity="0.5"/>`
  ).join('');

  const activeIdx = stops.findIndex(s => s.id === trip.activeStopId);
  const cursorPt = activeIdx >= 0 ? pts[activeIdx] : null;
  const cursorSvg = cursorPt ? `
    <circle cx="${cursorPt.x}" cy="${cursorPt.y - 2}" r="8" fill="${cursorFill}" opacity="0.15"/>
    <circle cx="${cursorPt.x}" cy="${cursorPt.y - 2}" r="5" fill="none" stroke="${cursorFill}" stroke-width="1.2"/>
    <circle cx="${cursorPt.x}" cy="${cursorPt.y - 2}" r="2" fill="${cursorFill}"/>` : '';

  const markersSvg = pts.map((p, i) => `
    <circle cx="${p.x}" cy="${p.y}" r="11" fill="${markerBg}" stroke="${markerBorder}" stroke-width="1"/>
    <text x="${p.x}" y="${p.y + 3.5}" text-anchor="middle" fill="${markerText}" font-size="9" font-weight="600" font-family="Roboto,sans-serif">${i + 1}</text>
  `).join('');

  const zoomBtnX = W - 36, zoomBtnY = H - 40;
  const btnFill = isDark ? '#2a3040' : '#ffffff';
  const btnStroke = isDark ? '#4a5060' : '#d0d4da';
  const btnIcon = isDark ? '#a0a8b8' : '#555';
  const zoomSvg = `
    <rect x="${zoomBtnX}" y="${zoomBtnY}" width="24" height="18" rx="4" fill="${btnFill}" stroke="${btnStroke}" stroke-width="0.8"/>
    <line x1="${zoomBtnX + 8}" y1="${zoomBtnY + 5}" x2="${zoomBtnX + 16}" y2="${zoomBtnY + 5}" stroke="${btnIcon}" stroke-width="1.2"/>
    <line x1="${zoomBtnX + 12}" y1="${zoomBtnY + 3}" x2="${zoomBtnX + 12}" y2="${zoomBtnY + 7}" stroke="${btnIcon}" stroke-width="1.2"/>
    <line x1="${zoomBtnX + 8}" y1="${zoomBtnY + 13}" x2="${zoomBtnX + 16}" y2="${zoomBtnY + 13}" stroke="${btnIcon}" stroke-width="1.2"/>`;

  const ukLand = `
    <path d="M 110,20 Q 125,15 145,18 Q 165,22 178,35 Q 195,52 200,70
             Q 205,88 195,100 Q 185,112 175,120 Q 168,125 162,132
             Q 155,140 148,148 Q 140,152 130,148 Q 118,142 108,135
             Q 95,125 85,115 Q 75,105 70,90 Q 65,75 70,60
             Q 75,45 85,35 Q 95,25 110,20 Z"
          fill="${landFill}" stroke="${landStroke}" stroke-width="0.8"/>
    <path d="M 80,25 Q 88,18 98,20 Q 105,22 108,30 Q 106,38 98,40
             Q 88,38 82,32 Z"
          fill="${landFill}" stroke="${landStroke}" stroke-width="0.6" opacity="0.7"/>
    <ellipse cx="60" cy="65" rx="15" ry="22" fill="${landFill}" stroke="${landStroke}" stroke-width="0.6" opacity="0.5"/>
    <path d="M 220,25 Q 260,18 300,22 Q 330,28 340,50 Q 345,70 330,85
             Q 315,95 290,92 Q 260,88 240,78 Q 220,65 215,45 Q 215,32 220,25 Z"
          fill="${landFill}" stroke="${landStroke}" stroke-width="0.6" opacity="0.4"/>`;

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"
    style="width:100%;height:100%;display:block;background:${waterFill};border-radius:10px">
    ${ukLand}
    ${roadsSvg}
    ${citiesSvg}
    <path d="${pathD}" fill="none" stroke="${routeColor}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${pathD}" fill="none" stroke="${routeColor}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.2"/>
    ${cursorSvg}
    ${markersSvg}
    ${zoomSvg}
  </svg>`;
}

function tripDetailContent() {
  const trip = findActiveTrip(state.activeDetailTripId);
  if (!trip) return h`<div class="t-body-md t-muted" style="padding:24px;">Trip not found.</div>`;

  const tripStatus = trip.status || (trip.completed ? 'Completed' : (trip.activeStopId ? 'In Transit' : 'Scheduled'));
  const statusClass = tripStatus.toLowerCase().replace(/\s/g, '-');

  const stopOrderCount = s => typeof s.orders === 'number' ? s.orders : (Array.isArray(s.orders) ? s.orders.length : 0);
  const totalOrders = trip.stops.reduce((sum, s) => sum + stopOrderCount(s), 0);
  const totalItems = trip.stops.reduce((sum, s) => sum + (Array.isArray(s.orders) ? s.orders.reduce((a, o) => a + (o.cargo ? o.cargo.totalItems : 0), 0) : 0), 0);
  const totalWeight = trip.stops.reduce((sum, s) => sum + (Array.isArray(s.orders) ? s.orders.reduce((a, o) => a + (o.weight || 0), 0) : 0), 0);

  const mapHtml = h`
    <div class="td__map">
      ${buildRouteMapSvg(trip)}
    </div>`;

  const contactHtml = trip.contact ? h`
    <div class="td__card">
      <div class="td__card-title">CtrlChain Contact</div>
      <div class="td__contact-row"><sl-icon name="person" class="td__contact-icon"></sl-icon> ${trip.contact.name}</div>
      <div class="td__contact-row"><sl-icon name="building" class="td__contact-icon"></sl-icon> ${trip.contact.company}</div>
    </div>` : '';

  const tripConvos = conversationsForTrip(trip.id);

  const refRows = trip.stops.map((s, i) => {
    const typeLabel = s.type === 'pickup' ? 'Pickup' : s.type === 'delivery' ? 'Delivery' : s.type.charAt(0).toUpperCase() + s.type.slice(1);
    const refVal = (trip.references && trip.references[s.id]) || '—';
    return h`
      <div class="td__ref-row">
        <span class="td__ref-label">Stop ${i + 1} (${typeLabel}):</span>
        <span class="td__ref-value">${refVal}</span>
      </div>`;
  }).join('');

  const refsHtml = h`
    <div class="td__card">
      <div class="td__card-title">References</div>
      ${refRows}
    </div>`;

  const stopsHtml = h`
    <div class="route-strip">
      ${trip.stops.map((stop, i) => {
        const isLast = i === trip.stops.length - 1;
        const stopStatus = tripStopStatus(trip, stop);
        const statusCls = stopStatus.toLowerCase().replace(/\s/g, '-');
        const typeLabel = stop.type === 'pickup' ? 'Pickup' : stop.type === 'delivery' ? 'Delivery' : stop.type.charAt(0).toUpperCase() + stop.type.slice(1);
        const orderCount = stopOrderCount(stop);
        const hasInstructions = Array.isArray(stop.orders) ? stop.orders.some(o => o.instructions) : false;
        return h`
          <div class="route-strip__dot-cell">
            <span class="route-stop__dot ${statusCls === 'not-started' ? 'route-stop__dot--faded' : ''}"></span>
            ${!isLast ? h`<span class="route-stop__line"></span>` : ''}
          </div>
          <div class="route-stop-card">
            <div class="route-stop-card__content">
              <div class="route-stop-card__title-row">
                <span class="route-stop-card__loc">Stop ${i + 1}: ${typeLabel}</span>
                <span class="route-stop-card__badge">${orderCount} Order${orderCount === 1 ? '' : 's'}</span>
              </div>
              <div class="route-stop-card__addr">${stop.location}</div>
              <div class="route-stop-card__meta">Window: Tomorrow, ${stop.appointment}</div>
              <div class="route-stop-card__resources">Vehicle: ${trip.vehicle || '—'} &middot; Trailer: ${trip.trailer || '—'}</div>
            </div>
            ${stop.id ? h`<div class="stop-btn-row">
              <button type="button" class="stop-btn" onclick="App.openStopDetail('${trip.id}','${stop.id}')">Stop details</button>
              <button type="button" class="stop-btn ${hasInstructions ? '' : 'stop-btn--disabled'}" onclick="${hasInstructions ? `App.openInstructionsSheet('${trip.id}','${stop.id}')` : 'void(0)'}" ${hasInstructions ? '' : 'disabled'}>Read Instructions</button>
            </div>` : ''}
          </div>`;
      }).join('')}
    </div>`;

  return h`
    <div class="td">
      <div class="td__overview-header">
        <span class="sd__section-title" style="margin:0">Trip Overview</span>
        <span class="td__trip-badge td__trip-badge--${statusClass}">${tripStatus}</span>
      </div>
      ${mapHtml}
      ${contactHtml}
      ${refsHtml}
      ${stopsHtml}
    </div>
    ${tripConversationsSheetMarkup()}
    ${newConversationSheetMarkup()}`;
}

function stopDetailScreen() {
  const trip = findActiveTrip(state.activeDetailTripId);
  const stop = trip && findStop(trip, state.activeDetailStopId);
  if (!trip || !stop) return h`<div class="t-body-md t-muted" style="padding:24px;">Stop not found.</div>`;

  const hasInstructions = stop.orders.some(o => o.instructions);
  const hasPalletEx = stop.milestones.some(m => m.kind === 'pallet-exchange');
  const stopIdx = trip.stops.indexOf(stop) + 1;
  const stopHeading = 'Stop ' + stopIdx + ' of ' + trip.stops.length + ': ' + (stop.type === 'pickup' ? 'Pickup' : 'Delivery');

  return h`
    <div class="sd">
      <div class="sd__stop-heading">${stopHeading}</div>

      <div class="sd__milestones">
        ${stop.milestones.map((m, idx) => sdMilestoneItem(trip, stop, m, idx === 0, idx === stop.milestones.length - 1)).join('')}
      </div>

      <div class="sd__divider"></div>

      <div class="sd__section-title">Address &amp; Appointment</div>
      <div class="sd__addr-block">
        <div class="sd__addr-row">
          <sl-icon name="geo-alt" class="sd__icon-24"></sl-icon>
          <span class="sd__addr-text">${stop.location}</span>
        </div>
        <div class="sd__addr-row">
          <sl-icon name="clock" class="sd__icon-24"></sl-icon>
          <div class="sd__time-block">
            <div class="sd__time-label"><span class="sd__time-muted">Time window</span> <span class="sd__time-agreed">(Agreed)</span></div>
            <div class="sd__time-value">${stop.appointment}</div>
          </div>
        </div>
        <button type="button" class="sd__subtle-btn" onclick="void 0">Open in Map</button>
      </div>

      <div class="sd__divider"></div>

      <div class="sd__section-title">Stop Instructions</div>
      <button type="button" class="sd__subtle-btn${hasInstructions ? '' : ' sd__subtle-btn--disabled'}"
        ${hasInstructions ? 'onclick="App.openInstructionsSheet(\'' + trip.id + '\',\'' + stop.id + '\')"' : 'disabled'}>
        Read Instructions
      </button>

      <div class="sd__divider"></div>

      <div class="sd__section-title">Orders at this Stop</div>
      <div class="sd__orders">
        ${stop.orders.map((o, idx) => sdOrderCard(trip, stop, o, hasPalletEx)).join('')}
      </div>

    </div>
    ${podSheetMarkup()}
    ${exceptionSheetMarkup()}
    ${palletExchangeSheetMarkup()}
  `;
}

function sdOrderCard(trip, stop, order, hasPalletEx) {
  const expanded = !!state.orderCardExpanded[order.id];
  const palletParts = [];
  if (order.expectedPallets) palletParts.push(order.expectedPallets + ' Pallets');
  if (order.weight) palletParts.push(order.weight + ' kg');
  const pallets = palletParts.join(' · ');
  const needsExchange = hasPalletEx && order.expectedPallets;
  const exchangeLabel = needsExchange ? order.expectedPallets + '/' + order.expectedPallets + ' exchange needed' : '';

  const headerHtml = h`
    <button type="button" class="sd-order__header" onclick="App.toggleOrderCard('${order.id}')">
      <div class="sd-order__info">
        <div class="sd-order__customer">${order.customer || order.ref}</div>
        <div class="sd-order__pallets-row">
          ${pallets ? h`<span class="sd-order__pallets">${pallets}</span>` : ''}
          ${exchangeLabel ? h`<span class="sd-order__exchange-badge">${exchangeLabel}</span>` : ''}
        </div>
      </div>
      <span class="sd-order__chevron"><sl-icon name="${expanded ? 'chevron-up' : 'chevron-down'}"></sl-icon></span>
    </button>
  `;

  if (!expanded) {
    return h`<div class="sd-order sd-order--collapsed">${headerHtml}</div>`;
  }

  return h`
    <div class="sd-order sd-order--expanded">
      ${headerHtml}
      <div class="sd-order__divider"></div>
      <div class="sd-order__details">
        <div class="sd-order__ref-row">
          <span class="sd-order__ref-label">Order Reference</span>
          <span class="sd-order__ref-value">${order.ref}</span>
        </div>
        <div class="sd-order__ref-row">
          <span class="sd-order__ref-label">Stop Reference</span>
          <span class="sd-order__ref-value">${stop.id}</span>
        </div>
      </div>
      <button type="button" class="sd__secondary-btn" onclick="App.openOrderOverview('${trip.id}','${stop.id}','${order.id}')">More Info</button>
    </div>
  `;
}

function sdMilestoneItem(trip, stop, m, isFirst, isLast) {
  const isEta = m.kind === 'eta';
  const isPending = m.status === 'pending';
  const isProposed = m.status === 'proposed';
  const isConfirmed = m.status === 'confirmed';
  const isAssumed = m.status === 'assumed';
  const isReady = m.status === 'ready';
  const isActive = isEta || isConfirmed || isProposed || isReady || isAssumed;
  const editing = state.editingMilestone && state.editingMilestone.milestoneId === m.id;

  let statusHtml;
  if (editing) {
    statusHtml = h`
      <div class="timestamp-edit">
        <sl-input id="ts-input-${m.id}" type="time" size="small" value="${m.timestamp || ''}"></sl-input>
        <sl-button size="small" variant="primary" onclick="App.saveTimestamp('${trip.id}','${stop.id}','${m.id}')">Save</sl-button>
        <sl-button size="small" onclick="App.cancelEditTimestamp()">Cancel</sl-button>
      </div>`;
  } else if (isEta && m.timestamp) {
    statusHtml = h`
      <div class="sd-ms__eta-box">
        <span class="sd-ms__eta-label">System calculated:</span>
        <div class="sd-ms__eta-right">
          <span class="sd-ms__eta-time">${m.timestamp}</span>
          <button type="button" class="sd-ms__edit-btn" onclick="App.startEditTimestamp('${stop.id}','${m.id}')">
            <img class="sd-ms__edit-icon" src="assets/icon-edit.svg" alt="edit" />
          </button>
        </div>
      </div>`;
  } else if (isPending || (isEta && !m.timestamp)) {
    statusHtml = h`<span class="sd-ms__not-reached">Not yet reached</span>`;
  } else if (m.timestamp) {
    const src = stageSourceLabel(m);
    statusHtml = h`
      <div class="sd-ms__eta-box">
        <span class="sd-ms__eta-label">${src || 'Confirmed'}</span>
        <div class="sd-ms__eta-right">
          <span class="sd-ms__eta-time">${m.timestamp}</span>
          <button type="button" class="sd-ms__edit-btn" onclick="App.startEditTimestamp('${stop.id}','${m.id}')">
            <img class="sd-ms__edit-icon" src="assets/icon-edit.svg" alt="edit" />
          </button>
        </div>
      </div>`;
  } else {
    statusHtml = h`<span class="sd-ms__not-reached">Awaiting driver</span>`;
  }

  let actionHtml = '';
  if (!editing && isProposed) {
    actionHtml = h`<button type="button" class="stage-confirm-btn" style="margin-top:4px" onclick="App.confirmMilestone('${trip.id}','${stop.id}','${m.id}')">Confirm</button>`;
  }

  const hasOrderRows = m.kind === 'pod' || m.kind === 'pallet-exchange';
  const anyPalletMismatch = m.kind === 'pallet-exchange' && isConfirmed && stop.orders.some(o => o.palletMismatch);
  let subRowsHtml = '';
  if (hasOrderRows && !isPending && !(m.kind === 'pallet-exchange' && isConfirmed && !anyPalletMismatch)) {
    subRowsHtml = h`<div class="sd-ms__sub">${stop.orders.map(o => m.kind === 'pod' ? orderRow(trip, stop, o) : palletExchangeOrderRow(trip, stop, o)).join('')}</div>`;
  }

  return h`
    <div class="sd-ms${isFirst ? ' sd-ms--first' : ''}${isLast ? ' sd-ms--last' : ''}">
      <div class="sd-ms__track">
        ${!isFirst ? '<div class="sd-ms__line-top"></div>' : ''}
        <div class="sd-ms__dot ${isAssumed ? 'sd-ms__dot--assumed' : isActive ? 'sd-ms__dot--active' : 'sd-ms__dot--pending'}"></div>
        ${!isLast ? '<div class="sd-ms__line-bot"></div>' : ''}
      </div>
      <div class="sd-ms__body">
        <div class="sd-ms__label${isPending ? ' sd-ms__label--pending' : ''}">${m.label}${anyPalletMismatch ? h` <span class="badge badge--warning">Mismatch</span>` : ''}</div>
        ${statusHtml}
        ${actionHtml}
        ${subRowsHtml}
      </div>
    </div>`;
}

function orderOverviewContent() {
  if (!state.orderOverview) return h`<div class="empty-state"><sl-icon name="info-circle" style="font-size:32px"></sl-icon><p>No order selected.</p></div>`;
  const trip = findActiveTrip(state.orderOverview.tripId);
  const stop = trip && findStop(trip, state.orderOverview.stopId);
  const order = stop && stop.orders.find(o => o.id === state.orderOverview.orderId);
  if (!order) return h`<div class="empty-state"><p>Order not found.</p></div>`;

  const cargo = order.cargo || {};
  const items = cargo.items || [];

  const summaryGrid = h`
    <div class="oo__grid">
      <div class="oo__datum"><span class="oo__datum-label">Total Items</span><span class="oo__datum-value">${cargo.totalItems || '—'}</span></div>
      <div class="oo__datum"><span class="oo__datum-label">Total Weight</span><span class="oo__datum-value">${order.weight ? order.weight + ' kg' : '—'}</span></div>
      <div class="oo__datum"><span class="oo__datum-label">Food or Perishable</span><span class="oo__datum-value">${cargo.perishable || '—'}</span></div>
      <div class="oo__datum"><span class="oo__datum-label">Temperature sensitive</span><span class="oo__datum-value">${cargo.tempSensitive ? 'Yes' : 'No'}</span></div>
      <div class="oo__datum"><span class="oo__datum-label">Loading Method</span><span class="oo__datum-value">${cargo.loadingMethod || '—'}</span></div>
      <div class="oo__datum"><span class="oo__datum-label">Shipment Hazardous</span><span class="oo__datum-value">${cargo.hazardous ? 'Yes' : 'No'}</span></div>
    </div>`;

  return h`
    <div class="oo">
      <div class="sd__section-title">Cargo Summary</div>
      ${summaryGrid}

      <div class="sd__section-title" style="margin-top:16px">Item Info</div>
      <div class="oo__items">
        ${items.map((item, idx) => ooItemCard(item, idx)).join('')}
      </div>
    </div>`;
}

function ooItemCard(item, idx) {
  const expanded = !!state.orderOverviewItemExpanded[idx];
  const headerHtml = h`
    <button type="button" class="sd-order__header" onclick="App.toggleOrderOverviewItem(${idx})">
      <div class="sd-order__info">
        <div class="sd-order__customer" style="font-size:12px;font-weight:700">${item.label} &bull; ${item.weight} kg</div>
      </div>
      <span class="sd-order__chevron"><sl-icon name="${expanded ? 'chevron-up' : 'chevron-down'}"></sl-icon></span>
    </button>`;

  if (!expanded) {
    return h`<div class="sd-order sd-order--collapsed">${headerHtml}</div>`;
  }

  return h`
    <div class="sd-order sd-order--expanded">
      ${headerHtml}
      <div class="sd-order__divider"></div>
      <div class="oo__detail-rows">
        ${item.loadAt ? h`<div class="oo__detail-row"><sl-icon name="person-arms-up" class="oo__detail-icon"></sl-icon><div class="oo__detail-text"><span class="oo__detail-label">Loading at:</span><span class="oo__detail-value">${item.loadAt}</span></div></div>` : ''}
        ${item.unloadAt ? h`<div class="oo__detail-row"><sl-icon name="truck" class="oo__detail-icon"></sl-icon><div class="oo__detail-text"><span class="oo__detail-label">Unloading at:</span><span class="oo__detail-value">${item.unloadAt}</span></div></div>` : ''}
        ${item.reqExchange ? h`<div class="oo__detail-row"><sl-icon name="arrow-left-right" class="oo__detail-icon"></sl-icon><div class="oo__detail-text"><span class="oo__detail-label">Requested Exchange</span><span class="oo__detail-value">${item.reqExchange}</span></div></div>` : ''}
        ${item.actualExchange ? h`<div class="oo__detail-row"><sl-icon name="arrow-repeat" class="oo__detail-icon"></sl-icon><div class="oo__detail-text"><span class="oo__detail-label">Actual Exchanged</span><span class="oo__detail-value">${item.actualExchange}</span></div></div>` : ''}
        <div class="oo__detail-row"><sl-icon name="card-text" class="oo__detail-icon"></sl-icon><div class="oo__detail-text"><span class="oo__detail-label">Description</span><span class="oo__detail-value">${item.description || 'No description added yet.'}</span></div></div>
      </div>
    </div>`;
}

/* Notifications feed — mostly derived live from actual trip state (a proposed
   milestone awaiting confirm, a reported exception) rather than static mock
   copy, so it stays honest about what's actually happened in the session. */
function notificationUnreadCount() {
  return buildNotifications().filter(n => !n.read).length;
}

const NOTIF_TYPE_META = {
  'trip-assigned': { icon: 'truck', iconClass: 'notif-icon--trip' },
  'pod-rejected':  { icon: 'exclamation-triangle', iconClass: 'notif-icon--warning' },
  'milestone':     { icon: 'geo-alt', iconClass: 'notif-icon--trip' },
  'exception':     { icon: 'flag', iconClass: 'notif-icon--warning' },
};

function notificationCard(n) {
  const meta = NOTIF_TYPE_META[n.type] || NOTIF_TYPE_META['trip-assigned'];
  const unread = !n.read;
  return h`
    <div class="notif-card ${unread ? 'notif-card--unread' : ''}">
      <div class="notif-card__icon-wrap ${meta.iconClass}">
        <sl-icon name="${meta.icon}"></sl-icon>
        ${unread ? h`<span class="notif-card__dot"></span>` : ''}
      </div>
      <div class="notif-card__body">
        <div class="notif-card__header">
          <span class="notif-card__title ${unread ? '' : 'notif-card__title--read'}">${n.title}</span>
          <span class="notif-card__time">${n.time}</span>
        </div>
        <div class="notif-card__text">${n.body}${n.link ? h` <a class="notif-card__link">${n.link}</a>` : ''}</div>
      </div>
    </div>`;
}

function markAllReadDialogMarkup() {
  if (!state.markAllReadDialog) return '';
  return h`
    <div class="notif-dialog-overlay" onclick="App.closeMarkAllReadDialog()">
      <div class="notif-dialog" onclick="event.stopPropagation()">
        <div class="notif-dialog__title">Mark All As Read?</div>
        <div class="notif-dialog__body">This will mark all your notifications as read. You can still view them in the notification list.</div>
        <div class="notif-dialog__actions">
          <button type="button" class="notif-dialog__btn" onclick="App.closeMarkAllReadDialog()">Back</button>
          <button type="button" class="notif-dialog__btn notif-dialog__btn--primary" onclick="App.confirmMarkAllRead()">Confirm</button>
        </div>
      </div>
    </div>`;
}

function notificationsScreen() {
  const items = buildNotifications();
  const hasUnread = items.some(n => !n.read);
  if (!items.length) {
    return h`
      <div class="notif-empty">
        <sl-icon name="bell-slash" class="notif-empty__icon"></sl-icon>
        <div class="notif-empty__title">No notifications to show.</div>
        <div class="notif-empty__sub">You have not received any notification yet.</div>
      </div>`;
  }
  const groups = {};
  items.forEach(n => { (groups[n.date] = groups[n.date] || []).push(n); });
  const order = ['Today', 'This Week', 'Earlier'];
  return h`
    ${hasUnread ? h`<div class="notif-mark-all"><button type="button" class="notif-mark-all__btn" onclick="App.showMarkAllReadDialog()"><sl-icon name="check2-all"></sl-icon></button></div>` : ''}
    ${order.filter(g => groups[g]).map(g => h`
      <div class="notif-group">
        <div class="notif-group__label">${g}</div>
        ${groups[g].map(n => notificationCard(n)).join('')}
      </div>
    `).join('')}
    ${markAllReadDialogMarkup()}`;
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
  { route: 'nav-chats', icon: 'chat-dots', label: 'Conversations' },
  { route: 'nav-profile', icon: 'person', label: 'Profile' },
];
const TAB_ROUTES = TAB_ITEMS.map(t => t.route);

function tabBarMarkup(activeRoute) {
  const unreadChats = totalUnreadChats();
  return h`
    <div class="app-tabbar">
      ${TAB_ITEMS.map(item => {
        const badge = item.route === 'nav-chats' && unreadChats
          ? h`<span class="app-tabbar__badge">${unreadChats}</span>` : '';
        return h`
          <button type="button" class="app-tabbar__item ${item.route === activeRoute ? 'is-active' : ''}" onclick="App.goTab('${item.route}')">
            <span class="app-tabbar__icon-wrap">
              ${item.svg ? item.svg : h`<sl-icon class="app-tabbar__icon" name="${item.icon}"></sl-icon>`}
              ${badge}
            </span>
            <span class="app-tabbar__label">${item.label}</span>
          </button>
        `;
      }).join('')}
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
          <div class="social-icons-row">
            <button class="btn-social-icon" onclick="App.set('activeFlow','self-reg'); App.nav('self-reg-social-google')" aria-label="Continue with Google">
              <img src="assets/social-google.svg" alt="" />
            </button>
            <button class="btn-social-icon" onclick="App.set('activeFlow','self-reg'); App.nav('self-reg-social-apple')" aria-label="Continue with Apple">
              <img src="assets/social-apple.svg" alt="" />
            </button>
            <button class="btn-social-icon" onclick="App.set('activeFlow','self-reg'); App.nav('self-reg-social-microsoft')" aria-label="Continue with Microsoft">
              <img src="assets/social-microsoft.svg" alt="" />
            </button>
          </div>
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
  'self-reg-social-microsoft': () => oauthConsentScreen('microsoft'),

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
      <div class="field">
        <label class="field__label">Current carrier</label>
        <input class="field__input" placeholder="e.g. GTS Transport" value="${state.carrierName}" oninput="App.set('carrierName', this.value);" />
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
          ${palletExchangeSheetMarkup()}
        `,
      };
    }
    // full
    const { name, carrier } = currentDriverIdentity();
    const activeTrip = state.activeTrips[0];
    const activeStop = activeTrip && (activeTrip.stops.find(s => s.id === activeTrip.activeStopId) || activeTrip.stops[0]);
    const visibleActiveTrips = state.hideSecondActiveTrip ? state.activeTrips.slice(0, 1) : state.activeTrips;
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
          ${activeTripSection(visibleActiveTrips)}
        </div>
        <div class="dash-section">
          <div class="t-label-sm t-caption dash-section__label">SCHEDULED</div>
          ${state.scheduledTrips.length
            ? state.scheduledTrips.map(t => tripCard(t)).join('')
            : h`<div class="t-body-sm t-caption dash-empty-note">Nothing scheduled beyond the active trip.</div>`}
        </div>
        ${podSheetMarkup()}
        ${exceptionSheetMarkup()}
        ${palletExchangeSheetMarkup()}
        ${addTripSheetMarkup()}
      `,
      reviewerNote: (state.activeTrips.length > 1 ? h`
        <div class="reviewer-sticky__title">Active trips</div>
        <button type="button" class="reviewer-sticky__action" onclick="App.setAndRerender('hideSecondActiveTrip', false)">Show 2nd active trip${!state.hideSecondActiveTrip ? ' &#10003;' : ''}</button>
        <button type="button" class="reviewer-sticky__action" onclick="App.setAndRerender('hideSecondActiveTrip', true)">Hide 2nd active trip${state.hideSecondActiveTrip ? ' &#10003;' : ''}</button>
      ` : '') + (visibleActiveTrips.length ? visibleActiveTrips.map(t => {
        const pendingStops = t.stops.filter(s2 => stopStatus(s2) !== 'completed');
        if (!pendingStops.length) return h`<div class="reviewer-sticky__title">${t.id} — complete</div>`;
        return h`
          <div class="reviewer-sticky__title">${t.id}</div>
          ${pendingStops.map(s => {
            const stopNum = t.stops.indexOf(s) + 1;
            return h`
              <div class="reviewer-sticky__stop-label">Stop ${stopNum}: ${s.type === 'pickup' ? 'Pickup' : 'Delivery'}</div>
              <button type="button" class="reviewer-sticky__action" onclick="App.triggerGeofenceEntry('${t.id}','${s.id}')">Entry at ${s.location}</button>
              <button type="button" class="reviewer-sticky__action" onclick="App.triggerGeofenceExit('${t.id}','${s.id}')">Exit from ${s.location}</button>
              ${s.orders.some(o => o.instructions) ? h`<button type="button" class="reviewer-sticky__action" onclick="App.triggerInstructionsNotification('${t.id}','${s.id}')">Instructions available</button>` : ''}
            `;
          }).join('')}
        `;
      }).join('') : ''),
    };
  },

  /* ---------------- TRIP DETAIL ---------------- */

  'trip-detail': () => ({
    content: tripDetailContent(),
  }),

  /* ---------------- STOP DETAIL ---------------- */

  'stop-detail': () => ({
    content: stopDetailScreen(),
    reviewerNote: (() => {
      const trip = findActiveTrip(state.activeDetailTripId);
      const stop = trip && findStop(trip, state.activeDetailStopId);
      if (!trip || !stop) return '';
      return h`
        <div class="reviewer-sticky__title">Geofence simulation</div>
        <button type="button" class="reviewer-sticky__action" onclick="App.triggerGeofenceEntry('${trip.id}','${stop.id}')">Simulate entry (arrived)</button>
        <button type="button" class="reviewer-sticky__action" onclick="App.triggerGeofenceExit('${trip.id}','${stop.id}')">Simulate exit (loaded + departed)</button>
      `;
    })(),
  }),

  /* ---------------- STOP INSTRUCTIONS (full page) ---------------- */

  'stop-instructions': () => ({
    content: instructionsPageContent(),
  }),

  'order-overview': () => ({
    content: orderOverviewContent(),
  }),

  /* ---------------- BOTTOM TAB SCREENS ---------------- */

  'nav-trips': () => {
    const tab = state.tripsTab || 'active';
    const active = state.dashboardMode === 'guest' ? [state.guestTrip]
      : (state.hideSecondActiveTrip ? state.activeTrips.slice(0, 1) : state.activeTrips);

    function emptyState(icon, text, sub) {
      return h`
        <div class="tl-empty">
          <sl-icon name="${icon}" class="tl-empty__icon"></sl-icon>
          <div class="tl-empty__text">${text}</div>
          <div class="tl-empty__sub">${sub}</div>
        </div>
      `;
    }

    let tabContent = '';
    if (tab === 'new') {
      tabContent = state.scheduledTrips.length
        ? state.scheduledTrips.map(t => tripCard(t)).join('')
        : emptyState('clipboard', 'Nothing in your queue', 'Once a planner assigns a trip, it\'ll show up here.');
    } else if (tab === 'active') {
      tabContent = active.length
        ? activeTripSection(active)
        : emptyState('truck', 'No trips on the road', 'Once you start a trip, it\'ll show up here.');
    } else {
      tabContent = MOCK_TRIP_HISTORY.length
        ? MOCK_TRIP_HISTORY.map(t => tripCard(t)).join('')
        : emptyState('archive', 'No completed trips yet', 'Finished trips will appear here.');
    }

    return {
      content: h`
        <div class="tl-tabs">
          <button type="button" class="tl-tab ${tab === 'new' ? 'tl-tab--active' : ''}" onclick="App.switchTripsTab('new')">Scheduled</button>
          <button type="button" class="tl-tab ${tab === 'active' ? 'tl-tab--active' : ''}" onclick="App.switchTripsTab('active')">Active</button>
          <button type="button" class="tl-tab ${tab === 'finished' ? 'tl-tab--active' : ''}" onclick="App.switchTripsTab('finished')">Finished</button>
        </div>
        <div class="tl-content">
          ${tabContent}
        </div>
        ${addTripSheetMarkup()}
      `,
    };
  },

  'nav-notifications': () => ({
    content: h`${notificationsScreen()}`,
  }),

  'nav-chats': () => ({
    content: h`${chatListScreen()}`,
  }),

  'chat-conversation': () => ({
    hideHeader: true,
    content: h`${chatConversationScreen()}`,
  }),

  'nav-profile': () => {
    const { name, carrier, phone } = currentDriverIdentity();
    const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    const bio = state.profileBiometrics;
    const notif = state.profileNotifications;
    const t12 = state.profileTimeFormat12h;

    const toggle = (key) => `App.set('${key}', !state.${key}); render();`;
    const row = (icon, label, right, onclick) => h`
      <button type="button" class="profile-row" ${onclick ? `onclick="${onclick}"` : ''}>
        <sl-icon name="${icon}" class="profile-row__icon"></sl-icon>
        <span class="profile-row__label">${label}</span>
        <span class="profile-row__right">${right}</span>
      </button>`;
    const chevron = h`<sl-icon name="chevron-right" class="profile-row__chevron"></sl-icon>`;
    const toggleEl = (key) => h`<sl-switch ${state[key] ? 'checked' : ''} size="small" onclick="event.stopPropagation(); ${toggle(key)}"></sl-switch>`;

    return {
      content: h`
        <div class="profile-hero">
          <div class="profile-hero__avatar">${initials}</div>
          <div class="profile-hero__info">
            <div class="profile-hero__name">${name}</div>
            <div class="profile-hero__carrier">${carrier}</div>
            <div class="profile-hero__phone">${phone}</div>
          </div>
        </div>

        <div class="profile-section">
          <div class="profile-section__title">Account</div>
          ${row('key', 'Change Password', chevron)}
          ${row('shield-lock', 'Change PIN', chevron)}
          ${row('fingerprint', 'Biometrics', toggleEl('profileBiometrics'))}
        </div>

        <div class="profile-section">
          <div class="profile-section__title">Notifications</div>
          ${row('bell', 'Push Notifications', toggleEl('profileNotifications'))}
          ${row('envelope', 'Email Notifications', chevron)}
        </div>

        <div class="profile-section">
          <div class="profile-section__title">Preferences</div>
          ${row('translate', 'Language', h`<span class="profile-row__value">English</span>${chevron}`)}
          ${row('rulers', 'Unit of Measure', h`<span class="profile-row__value">Metric</span>${chevron}`)}
          ${row('clock', '12-Hour Format', toggleEl('profileTimeFormat12h'))}
        </div>

        <div class="profile-section">
          <div class="profile-section__title">Legal</div>
          ${row('file-text', 'Terms and Conditions', chevron)}
          ${row('shield-check', 'Privacy Policy', chevron)}
        </div>

        <div class="profile-footer">
          <div class="profile-version">Version 6.0.2</div>
          <button type="button" class="profile-logout" onclick="App.restartFlow()">
            <sl-icon name="box-arrow-right"></sl-icon> Log Out
          </button>
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
    return h`
      <div class="tracking-status">
        <sl-icon name="broadcast-pin" class="tracking-status__icon" aria-hidden="true"></sl-icon>
        Automatic tracking active
      </div>
    `;
  }
  return h`
    <div class="tracking-status tracking-status--limited">
      <sl-icon name="exclamation-triangle-fill" class="tracking-status__icon" aria-hidden="true"></sl-icon>
      <span class="tracking-status__text">Background tracking limited — arrival won't auto-detect.</span>
      <button type="button" class="tracking-status__fix" onclick="App.nav('location-priming')">Fix</button>
    </div>
  `;
}

/* ---------------------------------------------------------------- */
/* Chat screens                                                      */
/* ---------------------------------------------------------------- */

function conversationsForTrip(tripId) {
  return state.conversations.filter(c => c.tripId === tripId);
}

function conversationUnreadCount(conv) {
  return conv ? conv.messages.filter(m => m.unread).length : 0;
}

function totalUnreadChats() {
  return state.conversations.reduce((n, c) => n + conversationUnreadCount(c), 0);
}

/* Search matches on trip id, conversation title, and message text — the
   things a driver would actually remember about a conversation they're
   trying to find again ("that one about Bay 5", "the pickup thread", "the Bristol trip"). */
function chatMatchesSearch(conv, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  if (conv.tripId.toLowerCase().includes(q)) return true;
  if (conv.title.toLowerCase().includes(q)) return true;
  return conv.messages.some(m => m.text.toLowerCase().includes(q));
}

function chatListScreen() {
  if (!state.conversations.length) {
    return h`
      <div class="center-state">
        <sl-icon class="center-state__icon" name="chat-dots"></sl-icon>
        <div class="t-headline-md">No conversations yet</div>
        <div class="t-body-md t-muted">Conversations with CtrlChain will appear here once a trip is assigned.</div>
      </div>
    `;
  }

  const query = state.chatSearchQuery.trim();
  const filter = state.chatFilter;
  const visibleConvos = state.conversations.filter(conv => {
    if (filter === 'unread' && conversationUnreadCount(conv) === 0) return false;
    return chatMatchesSearch(conv, query);
  });
  const totalUnread = state.conversations.filter(c => conversationUnreadCount(c) > 0).length;

  return h`
    <div class="chat-list-screen">
      <div class="chat-search">
        <sl-icon name="search" class="chat-search__icon"></sl-icon>
        <input
          class="chat-search-input"
          type="text"
          placeholder="Search conversations"
          value="${state.chatSearchQuery}"
          oninput="App.setChatSearch(this.value)"
        />
        ${query ? h`
          <button type="button" class="chat-search__clear" onclick="App.setChatSearch('')" aria-label="Clear search">
            <sl-icon name="x-circle-fill"></sl-icon>
          </button>
        ` : ''}
      </div>
      <div class="chat-filter-pills">
        <button type="button" class="chat-filter-pill ${filter === 'all' ? 'is-selected' : ''}" onclick="App.setChatFilter('all')">All</button>
        <button type="button" class="chat-filter-pill ${filter === 'unread' ? 'is-selected' : ''}" onclick="App.setChatFilter('unread')">
          Unread${totalUnread ? h` <span class="chat-filter-pill__count">${totalUnread}</span>` : ''}
        </button>
      </div>
      ${visibleConvos.length ? h`
        <div class="chat-list">
          ${visibleConvos.map(conv => {
            const msgs = conv.messages.filter(m => m.from !== 'system');
            const last = msgs[msgs.length - 1];
            const unread = conversationUnreadCount(conv);
            const isActive = state.activeTrips.some(t => t.id === conv.tripId);
            return h`
              <button type="button" class="chat-row" onclick="App.openConversation('${conv.id}')">
                <div class="chat-row__avatar">
                  <sl-icon name="person-circle"></sl-icon>
                </div>
                <div class="chat-row__body">
                  <div class="chat-row__top">
                    <span class="chat-row__name t-label-md">${conv.title}</span>
                    <span class="chat-row__time t-body-sm t-caption">${last ? last.time : ''}</span>
                  </div>
                  <div class="chat-row__trip t-body-sm t-caption">
                    ${conv.contact.company} · ${conv.tripId}${isActive ? h` <span class="badge badge--info" style="font-size:10px;padding:1px 5px;">Active</span>` : ''}
                  </div>
                  <div class="chat-row__bottom">
                    <span class="chat-row__preview t-body-sm t-muted">${last ? (last.from === 'driver' ? 'You: ' : '') + last.text : ''}</span>
                    ${unread ? h`<span class="chat-row__unread">${unread}</span>` : ''}
                  </div>
                </div>
              </button>
            `;
          }).join('')}
        </div>
      ` : h`
        <div class="center-state">
          <sl-icon class="center-state__icon" name="chat-dots"></sl-icon>
          <div class="t-headline-md">${filter === 'unread' ? 'No unread conversations' : 'No matches'}</div>
          <div class="t-body-md t-muted">${query ? `Nothing matches "${query}".` : 'Nothing to show here right now.'}</div>
        </div>
      `}
    </div>
  `;
}

function chatConversationScreen() {
  const conv = state.conversations.find(c => c.id === state.activeConversationId);
  if (!conv) return h`<div class="center-state"><div class="t-body-md t-muted">Conversation not found.</div></div>`;

  const tripId = conv.tripId;
  const isActive = state.activeTrips.some(t => t.id === tripId);

  return h`
    <div class="chat-screen">
      <div class="chat-header">
        <button type="button" class="chat-header__back" onclick="App.back()">
          <sl-icon name="arrow-left"></sl-icon>
        </button>
        <div class="chat-header__info">
          <div class="chat-header__name t-label-md">${conv.title}</div>
          <div class="chat-header__meta t-body-sm t-caption">${conv.contact.company} · ${tripId}</div>
        </div>
      </div>
      <div class="chat-messages">
        <div class="chat-trip-pill">
          <sl-icon name="truck" style="font-size:13px"></sl-icon>
          <span class="t-body-sm">${tripId}</span>
          ${isActive ? h`<span class="badge badge--info" style="font-size:10px;padding:1px 5px;">In Transit</span>` : ''}
        </div>
        ${conv.messages.map(m => {
          if (m.from === 'system') {
            return h`<div class="chat-msg chat-msg--system"><span class="t-body-sm t-caption">${m.text}</span></div>`;
          }
          const isDriver = m.from === 'driver';
          return h`
            <div class="chat-msg ${isDriver ? 'chat-msg--driver' : 'chat-msg--planner'}">
              ${!isDriver ? h`<div class="chat-msg__sender t-body-sm t-caption">${conv.contact.name}</div>` : ''}
              <div class="chat-bubble ${isDriver ? 'chat-bubble--driver' : 'chat-bubble--planner'}">
                <div class="t-body-sm">${m.text}</div>
              </div>
              <div class="chat-msg__time t-body-sm t-caption">${m.time}</div>
            </div>
          `;
        }).join('')}
      </div>
      <div class="chat-input-bar">
        <input class="chat-input" type="text" placeholder="Type a message…" value="${state.chatInput}"
          oninput="App.setChatInput(this.value)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();App.sendChatMessage();}" />
        <button type="button" class="chat-send-btn${state.chatInput.trim() ? ' chat-send-btn--active' : ''}" onclick="App.sendChatMessage()">
          <sl-icon name="send"></sl-icon>
        </button>
      </div>
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
    const unreadCount = showBell ? notificationUnreadCount() : 0;
    const rightSlot = showBell
      ? h`<button type="button" class="app-header__bell" onclick="App.goTab('nav-notifications')" aria-label="Notifications">
            <sl-icon name="bell"></sl-icon>
            ${unreadCount ? h`<span class="app-header__bell-dot"></span>` : ''}
          </button>`
      : (route === 'trip-detail' || route === 'stop-detail') && state.activeDetailTripId
        ? (() => {
            const tripUnread = conversationsForTrip(state.activeDetailTripId).reduce((n, c) => n + conversationUnreadCount(c), 0);
            return h`<button type="button" class="app-header__bell" onclick="App.openTripConversationsSheet('${state.activeDetailTripId}')" aria-label="Conversations">
              <sl-icon name="chat-square-text"></sl-icon>
              ${tripUnread ? h`<span class="app-header__bell-dot"></span>` : ''}
            </button>`;
          })()
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
    ${pushNotificationBanner()}
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
    'pallet-exchange-drawer': () => App.closePalletExchangeSheet(),
    'add-trip-drawer': () => App.closeAddTripSheet(),
    'trip-conversations-drawer': () => App.closeTripConversationsSheet(),
    'new-conversation-drawer': () => App.closeNewConversationSheet(),
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
window.addEventListener('DOMContentLoaded', () => {
  const route = currentRoute();
  const needsStopState = ['trip-detail', 'stop-detail', 'order-overview', 'stop-instructions'].includes(route);
  if (needsStopState && !state.activeDetailTripId) {
    const fallback = FLOW_FIRST_ROUTE[state.activeFlow] || 'self-reg-welcome';
    window.location.hash = fallback;
    return;
  }
  render();
});

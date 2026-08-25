// Groups the 30+ free-form pipeline `stage` strings (server/seed.js) into a
// small set of funnel statuses, without touching the stage strings
// themselves — every existing kanban column, filter, and stored lead.stage
// value keeps working unchanged. This is purely an additional read/derived
// dimension (`lead.statusGroup`) for reporting and a "Status" column/filter.
export const STATUS_GROUPS = [
  'Pre-Trial',
  'Unresponsive',
  'Trial Scheduled',
  'Trial Completed',
  'Post-Trial Follow-up',
  'Disqualified',
  'Not Interested',
  'Lost',
  'Won'
]

// Keyed by the exact stage string as stored on a lead. Built from every
// stage value present in server/seed.js plus every value actually seen in
// production data (a few — 'Negotiation', 'Proposal Sent', 'Positive Trial
// Feedback - Interested in Membership' — exist only in real data, not in
// seed.js's list; included here so no live lead is left unmapped).
const STAGE_TO_STATUS_GROUP = {
  'New Enquiry': 'Pre-Trial',
  'Initial Contact': 'Pre-Trial',
  'Sent Introductory message': 'Pre-Trial',
  'Sent Introductory Message': 'Pre-Trial',
  'Shared Class Descriptions and Benefits': 'Pre-Trial',
  'Shared Pricing & Schedule Details': 'Pre-Trial',
  'Shared Pricing & Schedule details on WhatsApp': 'Pre-Trial',
  'Shared Membership Packages And Exclusive Deals': 'Pre-Trial',
  'Looking for Virtual Classes': 'Pre-Trial',
  'Looking For Virtual Classes': 'Pre-Trial',
  'Will get back to us at a later date': 'Pre-Trial',
  'Will come back once I exhaust my current gym membership': 'Pre-Trial',

  'Client Unresponsive': 'Unresponsive',
  'Called - Did Not Answer': 'Unresponsive',
  'Called - Did not answer': 'Unresponsive',
  'Called - Asked to Call back later': 'Unresponsive',
  'Called - Client out of town/traveling': 'Unresponsive',
  'Trial Completed - Unresponsive': 'Unresponsive',
  'No Response after Trial': 'Unresponsive',

  'Trial Scheduled': 'Trial Scheduled',
  'Trial Rescheduled': 'Trial Scheduled',

  'Trial Completed': 'Trial Completed',

  'Post Trial Follow Up': 'Post-Trial Follow-up',
  'Followed up with Trial Participants': 'Post-Trial Follow-up',
  'Trial Completed - Currently Travelling': 'Post-Trial Follow-up',
  'Positive Trial Feedback - Interested in Membership': 'Post-Trial Follow-up',
  'Negotiation': 'Post-Trial Follow-up',
  'Proposal Sent': 'Post-Trial Follow-up',

  'Called - Invalid Contact No': 'Disqualified',
  "Language Barrier - Couldn't comprehend or speak the language": 'Disqualified',
  'Not Interested - Proximity Issues': 'Disqualified',
  'Trial Completed - Proximity Issues': 'Disqualified',
  'Not Interested - Timings not suitable': 'Disqualified',

  'Not Interested - Other': 'Not Interested',
  'Not Interested - Pricing Issues': 'Not Interested',
  'Trial Completed - Pricing Issues': 'Not Interested',
  'Not Interested - Health Issues': 'Not Interested',
  'Trial Completed - Other Issues': 'Not Interested',
  "Trial Completed - Didn't like the class": 'Not Interested',

  'Lead Dropped or Lost': 'Lost',

  'Membership Sold': 'Won'
}

// Unmapped stage (a brand-new one added via Settings after this list was
// written) falls back to Pre-Trial — the safest default since it's the
// still-active/no-verdict-yet bucket, rather than silently miscounting it
// as Lost/Won/Disqualified.
export function statusGroupOf(stage) {
  return STAGE_TO_STATUS_GROUP[stage] || 'Pre-Trial'
}

import { uid, nowIso } from './db.js'
import { DEFAULT_LEAD_SOURCES, DEFAULT_MARKETING_CHANNELS, DEFAULT_CLASS_TYPES, DEFAULT_FOLLOW_UP_CHANNELS } from '../src/leadConfig.js'

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const DAY = 24 * 60 * 60 * 1000

export function seed() {
  const rng = mulberry32(20240802)

  const pick = (arr) => arr[Math.floor(rng() * arr.length)]
  const rand = (min, max) => min + Math.floor(rng() * (max - min + 1))

  const locations = [
    {
      id: 'loc_kemps', name: 'Kwality House, Kemps Corner', city: 'Mumbai', country: 'India',
      address: 'Kwality House, Kemps Corner, Marine Lines East', fullAddress: 'Kwality House, Kemps Corner, Mumbai 400026, India',
      timeZone: 'Asia/Kolkata', accent: 'rose', active: true
    },
    {
      id: 'loc_supreme', name: 'Supreme HQ, Bandra', city: 'Mumbai', country: 'India',
      address: 'Supreme HQ, Bandra West', fullAddress: 'Supreme HQ, Hill Road, Bandra West, Mumbai 400050, India',
      timeZone: 'Asia/Kolkata', accent: 'violet', active: true
    },
    {
      id: 'loc_kenkere', name: 'Kenkere House, Bengaluru', city: 'Bengaluru', country: 'India',
      address: 'Kenkere House, Bengaluru', fullAddress: 'Kenkere House, Bengaluru 560001, India',
      timeZone: 'Asia/Kolkata', accent: 'amber', active: true
    },
    {
      id: 'loc_indiranagar', name: 'the Studio by Copper + Cloves, Indiranagar', city: 'Bengaluru', country: 'India',
      address: 'the Studio by Copper + Cloves, Indiranagar', fullAddress: 'the Studio by Copper + Cloves, 100 Feet Road, Indiranagar, Bengaluru 560038, India',
      timeZone: 'Asia/Kolkata', accent: 'emerald', active: true
    }
  ]

  const associateDefs = [
    { locationId: 'loc_kemps', name: 'Zahur Shaikh', role: 'Studio Manager', email: 'zahur@physique57.in', color: '#f43f5e' },
    { locationId: 'loc_kemps', name: 'Priyanka Abnave', role: 'Sales Associate', email: 'priyanka@physique57.in', color: '#8b5cf6' },
    { locationId: 'loc_kemps', name: 'Akshay Rane', role: 'Sales Associate', email: 'akshay@physique57.in', color: '#06b6d4' },
    { locationId: 'loc_kemps', name: 'Shipra Bhika', role: 'Sales Associate', email: 'shipra@physique57.in', color: '#ec4899' },
    { locationId: 'loc_kemps', name: 'Manisha Rathod', role: 'Sales Associate', email: 'manisha@physique57.in', color: '#14b8a6' },
    { locationId: 'loc_kemps', name: 'Taahira Sayyed', role: 'Sales Associate', email: 'taahira@physique57.in', color: '#f59e0b' },
    { locationId: 'loc_supreme', name: 'Imran Shaikh', role: 'Studio Manager', email: 'imran@physique57.in', color: '#6366f1' },
    { locationId: 'loc_supreme', name: 'Sheetal Kataria', role: 'Sales Associate', email: 'sheetal@physique57.in', color: '#10b981' },
    { locationId: 'loc_supreme', name: 'Nadiya Shaikh', role: 'Sales Associate', email: 'nadiya@physique57.in', color: '#f97316' },
    { locationId: 'loc_supreme', name: 'Vahishta Fitter', role: 'Sales Associate', email: 'vahishta@physique57.in', color: '#7c3aed' },
    { locationId: 'loc_supreme', name: 'Deesha Changwani', role: 'Sales Associate', email: 'deesha@physique57.in', color: '#d946ef' },
    { locationId: 'loc_supreme', name: 'Shifa Ali', role: 'Sales Associate', email: 'shifa@physique57.in', color: '#0ea5e9' },
    { locationId: 'loc_kenkere', name: 'Rajkumar Venkatraman', role: 'Studio Manager', email: 'rajkumar@physique57.in', color: '#e11d48' },
    { locationId: 'loc_kenkere', name: 'Shahida Shinin', role: 'Sales Associate', email: 'shahida@physique57.in', color: '#9333ea' },
    { locationId: 'loc_kenkere', name: 'Wungsingla Serou', role: 'Sales Associate', email: 'wungsingla@physique57.in', color: '#0891b2' },
    { locationId: 'loc_kenkere', name: 'Prathap kp', role: 'Sales Associate', email: 'prathap@physique57.in', color: '#65a30d' },
    { locationId: 'loc_indiranagar', name: 'Nunu G Yepthomi', role: 'Studio Manager', email: 'nunu@physique57.in', color: '#db2777' },
    { locationId: 'loc_indiranagar', name: 'Pavanthika K', role: 'Sales Associate', email: 'pavanthika@physique57.in', color: '#2563eb' },
    { locationId: 'loc_indiranagar', name: 'Shashi Singh', role: 'Sales Associate', email: 'shashi@physique57.in', color: '#059669' },
    { locationId: 'loc_indiranagar', name: 'Yashas K', role: 'Sales Associate', email: 'yashas@physique57.in', color: '#ea580c' }
  ]
  const associates = associateDefs.map(a => ({
    ...a,
    id: uid('asn'),
    active: true,
    locationIds: [a.locationId],
    revenueTargetMonthly: rand(4, 9) * 100000,
    conversionTargetPct: rand(15, 30)
  }))

  const sources = [...DEFAULT_LEAD_SOURCES]
  const channels = [...DEFAULT_MARKETING_CHANNELS]
  const classTypes = [...DEFAULT_CLASS_TYPES]

  const stages = [
    'Membership Sold', 'Trial Completed', 'Shared Pricing & Schedule Details',
    'Not Interested - Other', 'Client Unresponsive', 'New Enquiry',
    'Sent Introductory message', 'Shared Class Descriptions and Benefits',
    'Post Trial Follow Up', 'Not Interested - Proximity Issues',
    'Will get back to us at a later date', 'Trial Scheduled',
    'Called - Did Not Answer', 'Called - Asked to Call back later',
    "Language Barrier - Couldn't comprehend or speak the language",
    'Called - Invalid Contact No', 'Not Interested - Timings not suitable',
    'Not Interested - Pricing Issues', 'Trial Rescheduled',
    'Not Interested - Health Issues', 'Lead Dropped or Lost',
    'Initial Contact', 'No Response after Trial',
    'Will come back once I exhaust my current gym membership',
    'Trial Completed - Proximity Issues', 'Trial Completed - Other Issues',
    'Trial Completed - Unresponsive', 'Trial Completed - Pricing Issues',
    'Trial Completed - Currently Travelling',
    'Called - Client out of town/traveling',
    'Shared Pricing & Schedule details on WhatsApp',
    'Called - Did not answer', 'Sent Introductory Message',
    'Looking for Virtual Classes', 'Followed up with Trial Participants',
    'Shared Membership Packages And Exclusive Deals',
    "Trial Completed - Didn't like the class", 'Looking For Virtual Classes',
    'Positive Trial Feedback - Interested in Membership'
  ]
  const openStages = stages.filter(s => !/^Membership Sold$|^Not Interested|^Lead Dropped or Lost$/.test(s))
  const fuChannels = [...DEFAULT_FOLLOW_UP_CHANNELS]

  const sourceChannel = {
    'Client Referral': 'Referrals & Word-of-Mouth',
    Instagram: 'Social Media',
    'Google Ads': 'Paid Ads',
    'Walk-in': 'In-Studio',
    'Website Form': 'Organic Search',
    Facebook: 'Social Media',
    'Marketing Event': 'Referrals & Word-of-Mouth',
    'WhatsApp Campaign': 'Email Campaign'
  }

  const firstNames = ['Akshay', 'Devyanee', 'Priya', 'Ananya', 'Rohit', 'Kavya', 'Arjun', 'Meera', 'Vikram', 'Sneha', 'Aditya', 'Nisha', 'Karan', 'Tanvi', 'Siddharth', 'Ishita', 'Rahul', 'Pooja', 'Amit', 'Shreya', 'Nikhil', 'Divya', 'Varun', 'Ritu', 'Manish', 'Karishma', 'Neha', 'Gaurav', 'Sonali', 'Ritesh', 'Pankhuri', 'Harsh', 'Juhi', 'Deepak', 'Riya', 'Kunal', 'Swati', 'Mohan', 'Alia', 'Farhan']
  const lastNames = ['Sharma', 'Kapoor', 'Iyer', 'Mehta', 'Khan', 'Patel', 'Nair', 'Joshi', 'Singh', 'Reddy', 'Dalmia', 'Tyagi', 'Kulkarni', 'Desai', 'Rao', 'Menon', 'Gupta', 'Chopra', 'Bhatia', 'Kumar', 'Mishra', 'Agarwal', 'Saxena', 'Verma', 'Bhalla', 'Sehgal', 'Rastogi', 'Kohli', 'Malhotra', 'Dutta', 'Ghosh', 'Banerjee']

  const remarkPool = [
    'Spoke to her, keen on trial class this week. Waiver link shared.',
    'Interested in Barre 57, asked about membership pricing.',
    'Referred by an existing member. Very warm lead.',
    'Came for a studio tour, loved the energy. Will decide after trial.',
    'Saw the Instagram ad, wants a free trial session.',
    'Asked about class timings for the evening batch.',
    'Comparing with other boutique studios. Needs follow-up on pricing.',
    'Booked a trial class for Saturday morning.',
    'Completed trial class, asked for membership brochure.',
    'Wants a buddy package with her friend.',
    'Reached out via website form, prefers WhatsApp contact.',
    'Attended the open house event. High intent, needs proposal.'
  ]

  const fuPositive = [
    'Very interested, will confirm after discussing with husband.',
    'Loved the trial class, wants to start next month.',
    'Asked about annual plan discounts.',
    'Confirmed for Saturday trial class at 10:30am.',
    'Asked for the payment link, ready to enroll.',
    'Excited about the new schedule. Wants Monday/Wednesday slots.'
  ]
  const fuNeutral = [
    'Not keeping well, will get back next week.',
    'Asked for more time to decide.',
    'Shared schedule, awaiting response.',
    'Said she will call back after office hours.',
    'Requested a call next week instead of WhatsApp.'
  ]
  const fuNegative = [
    'Not interested at the moment.',
    'Decided to go with a different studio.',
    'Budget constraints, will revisit later.',
    'No response to calls or messages for a week.'
  ]

  const leads = []

  const today = new Date()
  const todayKey = today.toISOString().slice(0, 10)
  const count = 128
  for (let i = 0; i < count; i++) {
    const location = pick(locations)
    const locAssociates = associates.filter(a => a.locationId === location.id)
    const stage = (() => {
      const r = rng()
      if (r < 0.16) return 'New Lead'
      if (r < 0.34) return 'Contacted'
      if (r < 0.47) return 'Trial Booked'
      if (r < 0.57) return 'Trial Completed'
      if (r < 0.72) return 'Follow Up'
      if (r < 0.80) return 'Proposal Sent'
      if (r < 0.87) return 'Negotiation'
      if (r < 0.94) return 'Won'
      return 'Lost'
    })()

    const firstName = pick(firstNames)
    const lastName = pick(lastNames)
    const source = pick(sources)
    const createdOffset = Math.floor(170 * Math.pow(rng(), 0.55))
    const createdAt = new Date(today.getTime() - createdOffset * DAY)
    const isWon = stage === 'Won'
    const isLost = stage === 'Lost'
    const converted = isWon ? new Date(createdAt.getTime() + rand(3, 30) * DAY) : null
    const hasMember = isWon || rng() < 0.35
    const memberId = hasMember ? String(rand(1000000, 20999999)) : null
    const fuCount = isWon || isLost ? rand(1, 5) : rand(1, 4)
    const followUps = []
    let fuDate = new Date(createdAt.getTime() + rand(1, 4) * DAY)
    for (let f = 0; f < fuCount; f++) {
      const isLast = f === fuCount - 1
      const channel = pick(fuChannels)
      const pendingFuture = !isWon && !isLost && isLast && rng() < 0.45
      const pastPending = !isWon && !isLost && isLast && rng() < 0.35
      const comments = rng() < 0.3 ? pick(fuPositive) : rng() < 0.4 ? pick(fuNeutral) : pick(fuNegative)
      if (pendingFuture) {
        followUps.push({ id: uid('fu'), date: new Date(fuDate.getTime() + rand(1, 5) * DAY).toISOString().slice(0, 10), comments, channel, done: false })
      } else if (pastPending) {
        followUps.push({ id: uid('fu'), date: new Date(fuDate.getTime() - rand(2, 9) * DAY).toISOString().slice(0, 10), comments, channel, done: false })
      } else {
        followUps.push({ id: uid('fu'), date: fuDate.toISOString().slice(0, 10), comments, channel, done: true })
      }
      fuDate = new Date(fuDate.getTime() + rand(2, 12) * DAY)
    }

    const isOpen = !isWon && !isLost
    leads.push({
      id: uid('lead'),
      fullName: `${firstName} ${lastName}`,
      phone: `91${rand(6000000000, 9999999999)}`,
      email: rng() < 0.12 ? '-' : `${firstName.toLowerCase()}.${lastName.toLowerCase()}${rand(1, 99)}@gmail.com`,
      createdAt: createdAt.toISOString(),
      sourceId: rand(8000, 8100),
      sourceName: source,
      memberId,
      convertedAt: converted ? converted.toISOString().slice(0, 10) : null,
      stage,
      status: isWon ? 'won' : isLost ? 'lost' : 'open',
      associateId: rng() < 0.92 ? pick(locAssociates).id : null,
      locationId: location.id,
      center: location.name,
      classType: pick(classTypes),
      hostId: rand(13000, 14000),
      remarks: pick(remarkPool),
      channel: sourceChannel[source],
      period: 'All Time',
      followUps,
      valueEstimate: isWon ? rand(25000, 90000) : isOpen ? (rng() < 0.7 ? rand(15000, 75000) : null) : null,
      lastActivityAt: new Date(createdAt.getTime() + followUps.length * 6 * DAY).toISOString()
    })
  }

  const sample = {
    id: uid('lead'), fullName: 'Akshay Tyagi', phone: '919930020986', email: 'karan@manorramapictures.com',
    createdAt: '2024-04-25T10:00:00.000Z', sourceId: 8076, sourceName: 'Client Referral', memberId: '15875720',
    convertedAt: '2024-07-18', stage: 'Won', status: 'won', associateId: null, locationId: 'loc_kemps',
    remarks: 'Spoke to her Fareeda kanga have given the ref will be coming for trial class 10:30am wednesday at kemps',
    center: 'Kwality House, Kemps Corner', classType: 'Barre 57', hostId: 13752, channel: 'Referrals & Word-of-Mouth',
    period: 'All Time', valueEstimate: 64000,
    followUps: [
      { id: uid('fu'), date: '2023-08-22', comments: 'She message upfront not keeping well, she will let us know when she would like to come for trial class', channel: 'whatsapp', done: true },
      { id: uid('fu'), date: '2023-08-24', comments: '3rd Sep : Whatsapp sent asking when she would like to come for trial class, As she asked not to call.', channel: 'whatsapp', done: true },
      { id: uid('fu'), date: '2023-08-26', comments: '-', channel: 'call', done: true }
    ]
  }
  leads.push(sample)

  const sample2 = {
    id: uid('lead'), fullName: 'Devyanee Dalmia', phone: '919831021068', email: '-', createdAt: '2024-04-25T10:30:00.000Z',
    sourceId: 8076, sourceName: 'Client Referral', memberId: '20007542', convertedAt: null, stage: 'Trial Completed', status: 'open',
    associateId: null, locationId: 'loc_kemps', center: 'Kwality House, Kemps Corner', classType: 'Barre 57', hostId: 13752,
    remarks: 'Spoke to her She is mithali friend will be coming today evening 5:45pm waiver link already shared with her',
    channel: 'Referrals & Word-of-Mouth', period: 'All Time', valueEstimate: 52000,
    followUps: [
      { id: uid('fu'), date: '2024-03-27', comments: 'Apoorva wanted to know what the schedule looked like and the same was shared.', channel: 'email', done: true },
      { id: uid('fu'), date: '2024-03-29', comments: 'Not answering, whatsapp sent asking convenient time to contact and assist for the enrollment', channel: 'whatsapp', done: true },
      { id: uid('fu'), date: '2024-03-31', comments: 'She dont want to enroll right now. She will get back when she want to enroll', channel: 'call', done: true },
      { id: uid('fu'), date: '2024-04-03', comments: 'She is not interested at the moment. Schedule shared this week kemps studio would she like to come this week for workout.', channel: 'sms', done: true }
    ]
  }
  leads.push(sample2)

  return {
    version: 2,
    seededAt: nowIso(),
    settings: {
      org: { name: 'Physique 57', brand: 'Studio 57', currency: 'INR', dateFormat: 'd MMM yyyy', timezone: 'Asia/Kolkata' },
      ui: { theme: 'dark', accent: 'rose', density: 'comfortable', glossy: true, showFollowUpColumns: true },
      business: { defaultStage: 'New Enquiry', defaultSource: 'Website Form', businessHoursStart: '10:00', businessHoursEnd: '20:00', supportEmail: 'studio@physique57.in' },
      cadence: {
        followUpDays: 3, outreachDays: 7, trialReminderDays: 1,
        steps: [
          { days: 1, channel: 'call', label: 'Follow-up 1' },
          { days: 3, channel: 'whatsapp', label: 'Follow-up 2' },
          { days: 7, channel: 'email', label: 'Follow-up 3' },
          { days: 14, channel: 'call', label: 'Follow-up 4' }
        ],
        rules: []
      },
      notifications: { followUpAlerts: true, missedOutreachAlerts: true, leadAgeAlerts: true, highValueAlerts: true, weeklyReport: false, dailyDigest: false },
      ai: { autoScore: true, sentiment: true, suggestions: true, riskDetection: true },
      followUpChannels: fuChannels,
      momence: {
        clientId: '', clientSecret: '', username: '', password: '',
        hostId: '', connected: false, lastSyncAt: null, token: null
      },
      roundRobin: {
        enabled: true,
        mode: 'fair',
        autoAssignOnImport: true,
        skipInactive: true,
        rotation: {}
      },
      reminders: { followUpEnabled: true, leadAgeEnabled: true, highValueEnabled: true, emailReminders: false },
      gpt: { apiKey: '', model: 'gpt-4o-mini', enabled: true },
      respondio: { apiKey: '', workspaceId: '' },
      inbox: { snippets: [] },
      mailtrap: { host: '', port: 2525, user: '', pass: '', fromEmail: 'studio@physique57.in', fromName: 'Physique 57 Lead Studio', enabled: false },
      googleSheets: {
        clientId: '', clientSecret: '', refreshToken: '', accessToken: '', tokenExpiresAt: '',
        connectedEmail: '', sheetId: '', sheetTab: '', fieldMapping: {}, defaults: {},
        lastSyncAt: null, lastSyncCounts: null
      },
      zohoPeople: {
        clientId: '', clientSecret: '', refreshToken: '', accessToken: '', tokenExpiresAt: '',
        dataCenter: 'in', enabled: false, lastFetchAt: null, lastFetchError: null, onDuty: null
      }
    },
    locations,
    associates,
    stages,
    sources,
    channels,
    classTypes,
    leads,
    activity: [],
    importHistory: [],
    webhookIntegrations: [],
    webhookLogs: [],
    sheetSyncLogs: [],
    inbox: { messages: [], conversations: {} }
  }
}

export const DEFAULT_LEAD_SOURCES = [
  'Social - Instagram', 'Client Referral', 'Hosted Class', 'Social', 'Website',
  'Yellow Messenger/Whatsapp Enquiry', 'Incoming call', 'Walkin', 'Abandoned checkout',
  'Social - Facebook', 'Dashboard', 'Enquiry on call', 'Staff Referral', 'Influencer Sign-up',
  'Outdoor Class', 'Incoming sms', 'Website - Pre/Post Natal', 'Website Form',
  'The Amazing Race Signups', 'Physique Kids', 'Influencer Marketing - Inde Wild', 'Website - AC',
  'Influencer Marketing - Shaan', 'Influencer Marketing - The Mum Tribe', 'Events - Stronger in 30',
  'Paid Meta Ads (FB/Instagram)', 'Endpoint (API)', 'Influencer Marketing - Dhun Wellness',
  'Other', 'Influencer Marketing', 'Website Copper + Cloves', 'Pop Up', 'Social Media', 'Missed call'
]

export const DEFAULT_MARKETING_CHANNELS = [
  'Social Media', 'Referrals', 'Hosted Classes & Events', 'Website & Forms', 'WhatsApp & SMS',
  'Phone', 'Walk-in', 'Influencer Marketing', 'Paid Media', 'API & Dashboard', 'Other'
]

export const DEFAULT_CLASS_TYPES = [
  'Studio Hosted Class', 'Studio FIT', 'Studio Back Body Blaze', 'Studio Barre 57', 'Studio Mat 57',
  "Studio Trainer's Choice", 'Studio Cardio Barre Express', 'Studio Amped Up!', 'Studio HIIT',
  'Studio Foundations', 'Studio SWEAT In 30', 'Studio Cardio Barre Plus', 'Studio Barre 57 Express',
  'Studio Cardio Barre', 'Studio Back Body Blaze Express', 'Studio Recovery', 'Studio Pre/Post Natal',
  'Studio Mat 57 Express', 'Studio PowerCycle', 'Studio PowerCycle Express',
  'Studio Strength Lab (Full Body)', 'Studio Strength Lab (Pull)', 'Studio Strength Lab (Push)',
  'Studio Strength Lab'
]

export const DEFAULT_FOLLOW_UP_CHANNELS = ['call', 'whatsapp', 'email', 'sms', 'in_person']

export const defaultChannelForSource = (source = '') => {
  if (/instagram|facebook|social/i.test(source)) return 'Social Media'
  if (/referral/i.test(source)) return 'Referrals'
  if (/hosted|class|event|race|pop up|outdoor/i.test(source)) return 'Hosted Classes & Events'
  if (/website|checkout|form/i.test(source)) return 'Website & Forms'
  if (/whatsapp|sms|yellow/i.test(source)) return 'WhatsApp & SMS'
  if (/call/i.test(source)) return 'Phone'
  if (/walkin|walk-in/i.test(source)) return 'Walk-in'
  if (/influencer/i.test(source)) return 'Influencer Marketing'
  if (/paid meta/i.test(source)) return 'Paid Media'
  if (/api|dashboard|endpoint/i.test(source)) return 'API & Dashboard'
  return 'Other'
}

export const uniqueClean = (values = []) => [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))]

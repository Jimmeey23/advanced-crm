export function catalogGroup(item) {
  const name = String(item?.name || '').toLowerCase()
  if ((item?.price !== null && item?.price !== undefined && Number(item.price) === 0) || /(complimentary|complementary|\bfree\b|staff\s*\/|staff family)/i.test(name)) return 'Complimentary'
  if (/(unlimited|\bu\s*\/\s*l\b)/i.test(name)) return 'Unlimited memberships'
  return 'Class packages'
}

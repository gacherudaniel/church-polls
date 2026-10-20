/**
 * Fictional nominations used by ?mock mode and the tests. They copy the kinds of
 * messiness real form responses have: first-name-only entries, spelling variants,
 * stray spaces and ambiguous first names.
 */
(function (root) {
  const SAMPLE_RESPONSES = [
    ['Timestamp', 'Nominee for Chairperson', 'Nominee for Vice Chairperson', 'Nominee for Secretary', 'Nominee for Vice Secretary', 'Nominee for Treasurer', 'Any comments?'],
    ['18/10/2026 21:16:24', 'Peter Mwangi', 'Lydia Achieng', 'Grace Njeri', 'Brian Otieno', 'Samuel Kariuki', ''],
    ['18/10/2026 21:20:31', 'Grace Njeri', 'Kevin Omondi', 'Faith', 'Bri', 'Grace Njeri', ''],
    ['18/10/2026 21:45:42', 'Paul', 'Esther Wanjiru', 'Naomi', 'Grace', 'Josephine', ''],
    ['18/10/2026 22:36:57', 'Paul Kamau Njoroge', 'Ruth Chebet', 'Lucy Atieno', 'Grace Achieng', 'Samuel Kariuki', ''],
    ['19/10/2026 08:18:08', 'Mary Wambui', 'Peter Mwangi', 'Hannah Moraa', 'Grace Njeri ', 'Samuel Kariuki ', ''],
    ['19/10/2026 10:26:07', 'Paul Njoroge', 'Joyce', 'Faith Wairimu', 'Tom', 'Sam', 'Praying for the new team'],
    ['19/10/2026 12:09:24', 'Faith Wairimu Kamau', 'Daniel Kiprop Rotich', 'Rose Akinyi', 'Josephine Wanjiku Mbugua', 'Samuel Mwangi Kariuki ', 'May the incoming team serve diligently'],
    ['20/10/2026 09:18:04', 'Sam', 'Grace', 'Kiki', 'Akinyi', 'Hannah', ''],
    ['20/10/2026 09:21:06', 'Faith', 'Rose', 'Joyce', 'Mercy', 'Sam', ''],
    ['20/10/2026 09:50:42', 'Tom Ochieng', 'Rose Akinyi', 'Josephine  ', 'Lucy', 'Joyce ', 'Could we also elect media team leads?'],
    ['20/10/2026 10:56:13', 'Kamau', 'Grace', 'Josefine', 'Tom', 'Sam', ''],
    ['20/10/2026 11:20:54', 'Faith', 'Dan', 'Lucy', 'Josephine', 'Sam', 'Media and PR should be separate groups'],
  ];

  if (typeof module !== 'undefined' && module.exports) module.exports = { SAMPLE_RESPONSES };
  else root.SAMPLE_RESPONSES = SAMPLE_RESPONSES;
})(typeof globalThis !== 'undefined' ? globalThis : this);

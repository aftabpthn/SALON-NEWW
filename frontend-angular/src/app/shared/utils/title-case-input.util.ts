const TITLE_CASE_WORDS = new Set([
  'brand', 'category', 'city', 'color', 'company', 'country', 'department', 'designation',
  'group', 'label', 'material', 'name', 'relationship', 'role', 'state', 'title',
]);

const PRESERVE_CASE_WORDS = new Set([
  'address', 'barcode', 'code', 'description', 'email', 'file', 'gst', 'id', 'invoice',
  'json', 'link', 'login', 'note', 'otp', 'pan', 'password', 'path', 'phone', 'query',
  'reference', 'search', 'sku', 'slug', 'tax', 'token', 'uri', 'url', 'username',
]);

export function titleCaseWords(value: string): string {
  return value.replace(/\S+/gu, (word) => word[0].toLocaleUpperCase() + word.slice(1).toLocaleLowerCase());
}

export function isTitleCaseField(metadata: string): boolean {
  const words = metadata
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .toLocaleLowerCase()
    .match(/[a-z\d]+/g) ?? [];
  return words.some((word) => TITLE_CASE_WORDS.has(word))
    && !words.some((word) => PRESERVE_CASE_WORDS.has(word));
}

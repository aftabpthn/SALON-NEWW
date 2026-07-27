import hindi from './hi-in';

const independent: Record<string, string> = {
  अ: 'a', आ: 'aa', इ: 'i', ई: 'ee', उ: 'u', ऊ: 'oo', ए: 'e', ऐ: 'ai', ओ: 'o', औ: 'au',
  ऋ: 'ri',
};

const vowelSigns: Record<string, string> = {
  'ा': 'aa', 'ि': 'i', 'ी': 'ee', 'ु': 'u', 'ू': 'oo', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au',
  'ृ': 'ri',
};

const consonants: Record<string, string> = {
  क: 'k', ख: 'kh', ग: 'g', घ: 'gh', च: 'ch', छ: 'chh', ज: 'j', झ: 'jh', ट: 't', ठ: 'th',
  ड: 'd', ढ: 'dh', ण: 'n', त: 't', थ: 'th', द: 'd', ध: 'dh', न: 'n', प: 'p', फ: 'ph',
  ब: 'b', भ: 'bh', म: 'm', य: 'y', र: 'r', ल: 'l', व: 'v', श: 'sh', ष: 'sh', स: 's',
  ह: 'h', क्ष: 'ksh', त्र: 'tr', ज्ञ: 'gy',
};

const marks: Record<string, string> = {
  'ं': 'n', 'ँ': 'n', 'ः': 'h', '़': '', 'ॅ': 'e', 'ॉ': 'o',
};

function transliterate(value: string): string {
  let result = '';
  for (let i = 0; i < value.length; i += 1) {
    const two = value.slice(i, i + 2);
    const char = value[i];
    const consonant = consonants[two] ? two : char;
    if (consonants[consonant]) {
      const next = value[i + consonant.length];
      if (next === '्') {
        result += consonants[consonant];
        i += consonant.length;
      } else if (vowelSigns[next]) {
        result += consonants[consonant] + vowelSigns[next];
        i += consonant.length;
      } else {
        result += consonants[consonant] + 'a';
        i += consonant.length - 1;
      }
      continue;
    }
    result += independent[char] ?? vowelSigns[char] ?? marks[char] ?? char;
  }
  return result;
}

export default Object.fromEntries(
  Object.entries(hindi).map(([key, value]) => [key, transliterate(value)]),
) as typeof hindi;

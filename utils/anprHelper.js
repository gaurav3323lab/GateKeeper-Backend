const VALID_STATES = [
  'AN', 'AP', 'AR', 'AS', 'BR', 'CG', 'CH', 'DD', 'DL', 'DN', 'GA', 'GJ', 
  'HR', 'HP', 'JH', 'JK', 'KA', 'KL', 'LA', 'LD', 'MH', 'ML', 'MN', 'MP', 
  'MZ', 'NL', 'OD', 'OR', 'PB', 'PY', 'RJ', 'SK', 'TN', 'TS', 'TR', 'UA', 
  'UK', 'UP', 'WB'
];

const COMMON_STATE_CORRECTIONS = {
  'M1': 'MH', 'MI': 'MH', 'MO': 'MH', 'M0': 'MH',
  'D1': 'DL', 'DI': 'DL', 'DO': 'DL', 'D0': 'DL',
  'K1': 'KA', 'KI': 'KA',
  'H1': 'HR', 'HI': 'HR',
  'U1': 'UP', 'UI': 'UP', 'U0': 'UP', 'UO': 'UP',
  'G1': 'GJ', 'GI': 'GJ',
  'A1': 'AP', 'AI': 'AP',
  'T1': 'TS', 'TI': 'TS',
  'R1': 'RJ', 'RI': 'RJ',
  'W1': 'WB', 'WI': 'WB',
  'P1': 'PB', 'PI': 'PB',
  'C1': 'CH', 'CI': 'CH'
};

const CHAR_TO_DIGIT = {
  'O': '0', 'I': '1', 'Z': '2', 'S': '5', 'B': '8', 'G': '6', 'T': '1', 'L': '1', 'D': '0', 'Q': '0', 'A': '4'
};

const DIGIT_TO_CHAR = {
  '0': 'O', '1': 'I', '2': 'Z', '5': 'S', '8': 'B', '4': 'A', '6': 'G'
};

function forceDigit(char) {
  if (!char) return '';
  if (char >= '0' && char <= '9') return char;
  return CHAR_TO_DIGIT[char] || char;
}

function forceChar(char) {
  if (!char) return '';
  if (char >= 'A' && char <= 'Z') return char;
  return DIGIT_TO_CHAR[char] || char;
}

/**
 * Normalizes, formats, and programmatically auto-heals common OCR character recognition typos 
 * (like 0 vs O, 1 vs I, Z vs 2) in Indian number plates based on their positions and standard RTO/BH series layouts.
 * 
 * @param {string} ocrText The raw, noisy text output from Tesseract
 * @returns {object} { original, corrected, formatted, type }
 */
function cleanAndCorrectPlate(ocrText) {
  if (!ocrText) return { original: '', corrected: '', formatted: '', type: 'Unknown' };

  // 1. Convert to uppercase and strip non-alphanumeric characters except spaces
  let cleaned = ocrText.toUpperCase().replace(/[^A-Z0-9 ]/g, '');

  // 2. Remove HSRP license plate noise prefixes (IND, INDIA)
  let tempClean = cleaned.replace(/\s+/g, '');
  if (tempClean.startsWith('INDIA')) {
    cleaned = cleaned.substring(cleaned.indexOf('I') + 5);
  } else if (tempClean.startsWith('IND')) {
    cleaned = cleaned.substring(cleaned.indexOf('I') + 3);
  }

  // Strip all spaces for standard pattern parsing
  cleaned = cleaned.replace(/\s+/g, '');

  if (cleaned.length < 5) {
    return {
      original: ocrText.trim(),
      corrected: cleaned,
      formatted: ocrText.trim(),
      type: 'Unknown'
    };
  }

  // 3. BH Series detection: e.g. "22 BH 1234 AA" (YY BH #### XX)
  // Check if character 2,3 fits "BH" structure (e.g. "BH", "8H", "BH", "3H")
  const char2 = cleaned[2];
  const char3 = cleaned[3];
  const isBHPattern = (char2 === 'B' || char2 === '8') && 
                      (char3 === 'H' || char3 === '1' || char3 === 'I' || char3 === 'T' || char3 === 'L');
  
  if (cleaned.length >= 8 && cleaned.length <= 10 && isBHPattern) {
    // Correct BH Series
    const yearPart = forceDigit(cleaned[0]) + forceDigit(cleaned[1]);
    const bhPart = 'BH';
    
    // Number part: next 4 characters should be digits
    let numPart = '';
    for (let i = 4; i < Math.min(8, cleaned.length); i++) {
      numPart += forceDigit(cleaned[i]);
    }
    
    // Series part: remaining characters should be letters
    let seriesPart = '';
    for (let i = 8; i < cleaned.length; i++) {
      seriesPart += forceChar(cleaned[i]);
    }
    
    const corrected = `${yearPart}${bhPart}${numPart}${seriesPart}`;
    const formatted = `${yearPart} ${bhPart} ${numPart} ${seriesPart}`.trim();
    
    return {
      original: ocrText.trim(),
      corrected,
      formatted,
      type: 'BH'
    };
  }

  // 4. Standard RTO License Plate: State(2) + RTO(2) + Series(0-3) + Number(1-4)
  // State Code (indices 0 and 1)
  let stateChar0 = forceChar(cleaned[0]);
  let stateChar1 = forceChar(cleaned[1]);
  let statePart = stateChar0 + stateChar1;

  // Apply visual RTO state corrections
  if (!VALID_STATES.includes(statePart)) {
    if (COMMON_STATE_CORRECTIONS[statePart]) {
      statePart = COMMON_STATE_CORRECTIONS[statePart];
    }
  }

  // RTO Code (indices 2 and 3)
  const rtoPart = forceDigit(cleaned[2]) + forceDigit(cleaned[3]);

  // Suffix (remaining characters starting from index 4)
  const suffix = cleaned.substring(4);
  
  if (suffix.length === 0) {
    const corrected = statePart + rtoPart;
    return {
      original: ocrText.trim(),
      corrected,
      formatted: `${statePart} ${rtoPart}`.trim(),
      type: 'RTO'
    };
  }

  // Run dynamic split scoring to find the series / number boundary
  let bestSplit = 0;
  let maxScore = -Infinity;
  
  // k is the length of the series letters candidate (up to 3 chars)
  const maxK = Math.min(3, suffix.length);
  for (let k = 0; k <= maxK; k++) {
    const seriesCandidate = suffix.substring(0, k);
    const numberCandidate = suffix.substring(k);
    
    // Registration numbers are at most 4 digits
    if (numberCandidate.length > 4) continue;
    
    let score = 0;
    
    // Score series letters candidate (expects letters)
    for (let i = 0; i < seriesCandidate.length; i++) {
      const c = seriesCandidate[i];
      if (c >= 'A' && c <= 'Z') {
        score += 1.5;
      } else if (CHAR_TO_DIGIT[c]) {
        score += 0.5;
      } else {
        score -= 1.0;
      }
    }
    
    // Score registration numbers candidate (expects digits)
    for (let i = 0; i < numberCandidate.length; i++) {
      const c = numberCandidate[i];
      if (c >= '0' && c <= '9') {
        score += 1.5;
      } else if (DIGIT_TO_CHAR[c]) {
        score += 0.5;
      } else {
        score -= 1.0;
      }
    }
    
    // Dynamic layout prior weights based on standard Indian layouts
    if (numberCandidate.length === 4) score += 1.0;
    else if (numberCandidate.length === 3) score += 0.4;
    else if (numberCandidate.length === 2) score += 0.1;
    
    if (seriesCandidate.length === 2) score += 0.8;
    else if (seriesCandidate.length === 1) score += 0.4;
    else if (seriesCandidate.length === 3) score += 0.2;
    
    if (score > maxScore) {
      maxScore = score;
      bestSplit = k;
    }
  }

  // Segment and correct parts using best split point
  const seriesRaw = suffix.substring(0, bestSplit);
  const numberRaw = suffix.substring(bestSplit);

  let seriesPart = '';
  for (let i = 0; i < seriesRaw.length; i++) {
    seriesPart += forceChar(seriesRaw[i]);
  }

  let numberPart = '';
  for (let i = 0; i < numberRaw.length; i++) {
    numberPart += forceDigit(numberRaw[i]);
  }

  const corrected = `${statePart}${rtoPart}${seriesPart}${numberPart}`;
  const formatted = `${statePart} ${rtoPart} ${seriesPart} ${numberPart}`.replace(/\s+/g, ' ').trim();

  return {
    original: ocrText.trim(),
    corrected,
    formatted,
    type: 'RTO'
  };
}

module.exports = {
  cleanAndCorrectPlate
};

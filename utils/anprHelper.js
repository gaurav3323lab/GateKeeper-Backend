const VALID_STATES = [
  'AN', 'AP', 'AR', 'AS', 'BR', 'CG', 'CH', 'DD', 'DL', 'DN', 'GA', 'GJ', 
  'HR', 'HP', 'JH', 'JK', 'KA', 'KL', 'LA', 'LD', 'MH', 'ML', 'MN', 'MP', 
  'MZ', 'NL', 'OD', 'OR', 'PB', 'PY', 'RJ', 'SK', 'TN', 'TS', 'TR', 'UA', 
  'UK', 'UP', 'WB'
];

const COMMON_STATE_CORRECTIONS = {
  // MH (Maharashtra) — M confused with N or W
  'M1': 'MH', 'MI': 'MH', 'MO': 'MH', 'M0': 'MH',
  'NH': 'MH', 'N1': 'MH', 'NI': 'MH', 'N0': 'MH', 'NO': 'MH',
  'WH': 'MH',
  // DL (Delhi) — D confused with O/Q/0
  'D1': 'DL', 'DI': 'DL', 'DO': 'DL', 'D0': 'DL',
  'OL': 'DL', 'O1': 'DL', 'OI': 'DL',
  'QL': 'DL', 'Q1': 'DL', 'QI': 'DL',
  '0L': 'DL', '01': 'DL', '0I': 'DL',
  // KA (Karnataka) — K confused with X; A confused with 4
  'K1': 'KA', 'KI': 'KA', 'KB': 'KA', 'K4': 'KA',
  'XA': 'KA', 'X1': 'KA', 'XI': 'KA',
  // HR (Haryana) — H confused with 1
  'H1': 'HR', 'HI': 'HR', 'H0': 'HR', 'HO': 'HR',
  // UP (Uttar Pradesh) — U confused with V; P confused with F
  'U1': 'UP', 'UI': 'UP', 'U0': 'UP', 'UO': 'UP',
  'VP': 'UP', '0P': 'UP', 'OP': 'UP',
  // GJ (Gujarat) — G confused with C/6; J confused with I/1
  'G1': 'GJ', 'GI': 'GJ', 'G0': 'GJ', 'GO': 'GJ',
  '61': 'GJ', '6I': 'GJ', '6J': 'GJ',
  // CH (Chandigarh) — C confused with G/6; H confused with 1
  'C1': 'CH', 'CI': 'CH', 'C0': 'CH', 'CO': 'CH', 'CJ': 'CH',
  // AP (Andhra Pradesh) — A confused with 4
  'A1': 'AP', 'AI': 'AP', 'A0': 'AP', 'AO': 'AP',
  '4P': 'AP', '41': 'AP', '4I': 'AP',
  // TS (Telangana) — T confused with 7
  'T1': 'TS', 'TI': 'TS', 'T0': 'TS', 'TO': 'TS',
  '7S': 'TS', '71': 'TS', '7I': 'TS',
  // RJ (Rajasthan) — J confused with I/1/L/N/Z
  'R1': 'RJ', 'RI': 'RJ', 'R0': 'RJ', 'RO': 'RJ',
  'R2': 'RJ', 'RZ': 'RJ', 'RN': 'RJ', 'RL': 'RJ',
  // WB (West Bengal) — B confused with I
  'W1': 'WB', 'WI': 'WB', 'W0': 'WB', 'WO': 'WB',
  // PB (Punjab) — P confused with F; B confused with I
  'P1': 'PB', 'PI': 'PB', 'P0': 'PB', 'PO': 'PB',
  'FB': 'PB', 'FI': 'PB',
  // JK (Jammu & Kashmir) — J confused with I/T; K confused with I
  'J1': 'JK', 'JI': 'JK', 'J0': 'JK', 'JO': 'JK',
  '1K': 'JK', 'IK': 'JK', 'TK': 'JK',
  // TN (Tamil Nadu) — 7 → T, 1/I → N (rare but happens)
  '7N': 'TN', '1N': 'TN',
  // BR (Bihar) — B confused with 8
  'B1': 'BR', 'BI': 'BR', 'B0': 'BR', 'BO': 'BR',
  '8R': 'BR', '81': 'BR', '8I': 'BR',
  // JH (Jharkhand)
  '1H': 'JH', 'IH': 'JH',
  // OD (Odisha) — O confused with 0
  'O0': 'OD', '0D': 'OD', '00': 'OD',
  // MP (Madhya Pradesh)
  'MP': 'MP',
  // GA (Goa)
  'GA': 'GA', '6A': 'GA',
  // CG (Chhattisgarh)
  'CG': 'CG', '(G': 'CG',
  // HP (Himachal Pradesh)
  'HP': 'HP', '1P': 'HP',
  // AS (Assam)
  'AS': 'AS', '45': 'AS', 'A5': 'AS',
  // TR (Tripura)
  'TR': 'TR',
  // MN (Manipur), ML (Meghalaya), MZ (Mizoram)
  'MN': 'MN', 'ML': 'ML', 'MZ': 'MZ',
  // UK (Uttarakhand)
  'UK': 'UK', 'U1K': 'UK',
};

const VALID_RTO_RANGES = {
  'DL': { min: 1, max: 14 },
  'MH': { min: 1, max: 52 },
  'UP': { min: 11, max: 96 },
  'KA': { min: 1, max: 71 },
  'CH': { min: 1, max: 4 },
  'GJ': { min: 1, max: 38 },
  'HR': { min: 1, max: 99 },
  'TS': { min: 1, max: 36 },
  'AP': { min: 1, max: 39 },
  'BR': { min: 1, max: 57 },
  'WB': { min: 1, max: 99 },
  'PB': { min: 1, max: 99 },
  'RJ': { min: 1, max: 58 },
  'TN': { min: 1, max: 99 }
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

  // 1. Convert to uppercase and strip ALL non-alphanumeric characters (except Military caret)
  let cleaned = ocrText.toUpperCase().replace(/[^A-Z0-9^]/g, '');

  // 2. Military (Defence) Plate check
  // Standard format starts with an upward caret ^ (or OCR-ed as A, 7, 1) and contains 8-11 characters
  const startChar = cleaned[0];
  const isMilitaryPattern = (startChar === '^' || startChar === 'A' || startChar === '7') && 
                            cleaned.length >= 8 && cleaned.length <= 11 && 
                            !isNaN(cleaned[1]) && !isNaN(cleaned[2]);
  
  if (isMilitaryPattern) {
    const yearPart = forceDigit(cleaned[1]) + forceDigit(cleaned[2]);
    const classLetter = forceChar(cleaned[3]);
    let numPart = '';
    let lastChar = '';
    
    for (let i = 4; i < cleaned.length; i++) {
      if (i === cleaned.length - 1 && isNaN(cleaned[i])) {
        lastChar = forceChar(cleaned[i]);
      } else {
        numPart += forceDigit(cleaned[i]);
      }
    }
    
    if (numPart.length >= 5) {
      const corrected = `↑${yearPart}${classLetter}${numPart}${lastChar}`;
      const formatted = `↑ ${yearPart} ${classLetter} ${numPart} ${lastChar}`.trim();
      return {
        original: ocrText.trim(),
        corrected,
        formatted,
        type: 'Military'
      };
    }
  }

  // Normal HSRP noise cleanup (strip caret now that military check is done)
  cleaned = cleaned.replace(/[^A-Z0-9]/g, '');
  const hsrpRegex = /^[1IL]ND(?:1A|IA|A)?/;
  cleaned = cleaned.replace(hsrpRegex, '');

  if (cleaned.length < 5) {
    return {
      original: ocrText.trim(),
      corrected: cleaned,
      formatted: ocrText.trim(),
      type: 'Unknown'
    };
  }

  // 3. BH Series detection: e.g. "22 BH 1234 AA" (YY BH #### XX)
  const char2 = cleaned[2];
  const char3 = cleaned[3];
  const isBHPattern = (char2 === 'B' || char2 === '8') && 
                      (char3 === 'H' || char3 === '1' || char3 === 'I' || char3 === 'T' || char3 === 'L');
  
  if (cleaned.length >= 8 && cleaned.length <= 10 && isBHPattern) {
    const yearPart = forceDigit(cleaned[0]) + forceDigit(cleaned[1]);
    const bhPart = 'BH';
    
    let numPart = '';
    for (let i = 4; i < Math.min(8, cleaned.length); i++) {
      numPart += forceDigit(cleaned[i]);
    }
    
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

  // 4. Temporary Registration Indicator (e.g. MH 12 TEMP 1234, TS 12 TMP 1234)
  const isTemporary = cleaned.includes('TEMP') || cleaned.includes('TMP');
  if (isTemporary) {
    const tempWord = cleaned.includes('TEMP') ? 'TEMP' : 'TMP';
    const splitParts = cleaned.split(tempWord);
    if (splitParts.length === 2) {
      const leftPart = splitParts[0];
      const rightPart = splitParts[1];
      
      let leftState = forceChar(leftPart[0]) + forceChar(leftPart[1]);
      if (COMMON_STATE_CORRECTIONS[leftState]) leftState = COMMON_STATE_CORRECTIONS[leftState];
      
      const leftRto = forceDigit(leftPart[2]) + forceDigit(leftPart[3]);
      let rightNum = '';
      for (let i = 0; i < rightPart.length; i++) rightNum += forceDigit(rightPart[i]);
      
      const corrected = `${leftState}${leftRto}${tempWord}${rightNum}`;
      const formatted = `${leftState} ${leftRto} ${tempWord} ${rightNum}`;
      
      return {
        original: ocrText.trim(),
        corrected,
        formatted,
        type: 'Temporary'
      };
    }
  }

  // 5. Standard RTO License Plate: State(2) + RTO(2) + Series(0-3) + Number(1-4)
  let stateChar0 = forceChar(cleaned[0]);
  let stateChar1 = forceChar(cleaned[1]);
  let statePart = stateChar0 + stateChar1;

  if (!VALID_STATES.includes(statePart)) {
    if (COMMON_STATE_CORRECTIONS[statePart]) {
      statePart = COMMON_STATE_CORRECTIONS[statePart];
    }
  }

  const rtoPart = forceDigit(cleaned[2]) + forceDigit(cleaned[3]);
  
  // Apply Intelligent RTO Code Validation & Auto-Correction
  let correctedRto = rtoPart;
  if (VALID_RTO_RANGES[statePart]) {
    const range = VALID_RTO_RANGES[statePart];
    const rtoVal = parseInt(rtoPart, 10);
    if (rtoVal < range.min || rtoVal > range.max) {
      const firstDigit = rtoPart[0];
      const secondDigit = rtoPart[1];
      if (firstDigit > '1') {
        const tryZero = parseInt('0' + secondDigit, 10);
        const tryOne = parseInt('1' + secondDigit, 10);
        if (tryZero >= range.min && tryZero <= range.max) {
          correctedRto = '0' + secondDigit;
        } else if (tryOne >= range.min && tryOne <= range.max) {
          correctedRto = '1' + secondDigit;
        }
      }
    }
  }

  const suffix = cleaned.substring(4);
  
  if (suffix.length === 0) {
    const corrected = statePart + correctedRto;
    return {
      original: ocrText.trim(),
      corrected,
      formatted: `${statePart} ${correctedRto}`.trim(),
      type: 'RTO'
    };
  }

  let bestSplit = 0;
  let maxScore = -Infinity;
  
  const maxK = Math.min(3, suffix.length);
  for (let k = 0; k <= maxK; k++) {
    const seriesCandidate = suffix.substring(0, k);
    const numberCandidate = suffix.substring(k);
    
    if (numberCandidate.length > 4) continue;
    
    let score = 0;
    for (let i = 0; i < seriesCandidate.length; i++) {
      const c = seriesCandidate[i];
      if (c >= 'A' && c <= 'Z') score += 1.5;
      else if (DIGIT_TO_CHAR[c]) score += 0.5;
      else score -= 1.0;
    }
    
    for (let i = 0; i < numberCandidate.length; i++) {
      const c = numberCandidate[i];
      if (c >= '0' && c <= '9') score += 1.5;
      else if (CHAR_TO_DIGIT[c]) score += 0.5;
      else score -= 1.0;
    }
    
    if (numberCandidate.length === 0) score -= 5.0;
    else if (numberCandidate.length === 4) score += 1.0;
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

  const corrected = `${statePart}${correctedRto}${seriesPart}${numberPart}`;
  const formatted = `${statePart} ${correctedRto} ${seriesPart} ${numberPart}`.replace(/\s+/g, ' ').trim();

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

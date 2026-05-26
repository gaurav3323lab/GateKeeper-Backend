const { cleanAndCorrectPlate } = require('../utils/anprHelper');

const testCases = [
  // 1. Basic formatting and noise cleaning
  { input: 'MH-12-AB-1234', expected: 'MH12AB1234' },
  { input: 'KA.51.MB.8899', expected: 'KA51MB8899' },
  { input: 'HR/26/BC/4321', expected: 'HR26BC4321' },
  { input: 'IND MH12AB1234', expected: 'MH12AB1234' },
  { input: 'INDIA MH12AB1234', expected: 'MH12AB1234' },
  { input: 'I ND MH12AB1234', expected: 'MH12AB1234' },
  { input: '1ND MH12AB1234', expected: 'MH12AB1234' },
  { input: 'IND  MH-12_AB_1234', expected: 'MH12AB1234' },

  // 2. BH Series
  { input: '22 BH 1234 AA', expected: '22BH1234AA' },
  { input: '22BH1234AA', expected: '22BH1234AA' },
  { input: '22 B H 1234 AA', expected: '22BH1234AA' },
  { input: '228H1234AA', expected: '22BH1234AA' },
  { input: '22BHI234AA', expected: '22BH1234AA' },
  { input: '22BH1Z34AA', expected: '22BH1234AA' },
  { input: '22BH12344A', expected: '22BH1234AA' },

  // 3. Typo corrections in State and RTO codes
  { input: 'M112AB1234', expected: 'MH12AB1234' },
  { input: 'MI12AB1234', expected: 'MH12AB1234' },
  { input: 'D13CAB1234', expected: 'DL3CAB1234' },
  { input: 'DI3CAB1234', expected: 'DL3CAB1234' },
  { input: 'K151MB8899', expected: 'KA51MB8899' },
  { input: 'KI51MB8899', expected: 'KA51MB8899' },
  { input: 'U116Z9999', expected: 'UP16Z9999' },
  { input: 'UI16Z9999', expected: 'UP16Z9999' },
  { input: 'G101AA1234', expected: 'GJ01AA1234' },
  { input: 'GI01AA1234', expected: 'GJ01AA1234' },

  // 4. Common character substitutions (0 vs O, 1 vs I, Z vs 2, S vs 5, B vs 8, G vs 6)
  { input: 'MH1ZAB1Z34', expected: 'MH12AB1234' },
  { input: 'KA5IMB8899', expected: 'KA51MB8899' },
  { input: 'HR2GBC4321', expected: 'HR26BC4321' },
  { input: 'TN O2 AA 11', expected: 'TN02AA11' },
  { input: 'TNO2AA11', expected: 'TN02AA11' },
  { input: 'UP1629999', expected: 'UP16Z9999' }, // '2' is in series position, should be 'Z'
  { input: 'AP 31 AB 1O24', expected: 'AP31AB1024' },
  { input: 'GJ O1 AA 1234', expected: 'GJ01AA1234' },
  { input: 'DL3C9999', expected: 'DL3C9999' },
  { input: 'DL 3C 9999', expected: 'DL3C9999' },
  { input: 'DL-3C-9999', expected: 'DL3C9999' },
  { input: 'DL03C9999', expected: 'DL03C9999' },
  { input: 'DL 3CA 1234', expected: 'DL3CA1234' },
  { input: 'DL3C A1234', expected: 'DL3CA1234' },

  // 5. Short and long plates, varying registration digits
  { input: 'KL 01 A 1', expected: 'KL01A1' },
  { input: 'KL-O1-A-I', expected: 'KL01A1' },
  { input: 'MH 12 AB 123', expected: 'MH12AB123' },
  { input: 'MH 12 AB 12', expected: 'MH12AB12' },
  { input: 'MH 12 AB 1', expected: 'MH12AB1' },
  { input: 'MH 12 A 1234', expected: 'MH12A1234' },
  { input: 'MH12A1234', expected: 'MH12A1234' },
  { input: 'MH121234', expected: 'MH121234' },
  { input: 'MH12 1234', expected: 'MH121234' },
  { input: 'DL 1O C A 1Z34', expected: 'DL10CA1234' },

  // Extra tough real-world cases
  { input: 'MH I2 AB I234', expected: 'MH12AB1234' },
  { input: 'KA S1 MB B899', expected: 'KA51MB8899' }, // S -> 5, I -> 1, B -> 8
  { input: 'HR 26 BC 43Z1', expected: 'HR26BC4321' }, // Z -> 2
  { input: 'UP 16 Z 9O99', expected: 'UP16Z9099' }, // O -> 0
  { input: 'MH-12 AA-O001', expected: 'MH12AA0001' }, // O -> 0
  { input: 'DL3C9999', expected: 'DL3C9999' }
];

console.log('--------------------------------------------------');
console.log('ANPR Accuracy Benchmark - Baseline');
console.log('--------------------------------------------------');

let passed = 0;
const failures = [];

testCases.forEach((tc, idx) => {
  const result = cleanAndCorrectPlate(tc.input);
  const isMatch = result.corrected === tc.expected;

  if (isMatch) {
    passed++;
  } else {
    failures.push({
      index: idx + 1,
      input: tc.input,
      expected: tc.expected,
      got: result.corrected,
      formatted: result.formatted
    });
  }
});

const accuracy = (passed / testCases.length) * 100;
console.log(`Results: ${passed} / ${testCases.length} Passed`);
console.log(`Accuracy: ${accuracy.toFixed(2)}%`);
console.log('--------------------------------------------------');

if (failures.length > 0) {
  console.log('Failures:');
  failures.forEach(f => {
    console.log(`[Case #${f.index}] Input: "${f.input}"`);
    console.log(`  Expected: "${f.expected}"`);
    console.log(`  Got     : "${f.got}" (Formatted: "${f.formatted}")`);
    console.log('------------------');
  });
}

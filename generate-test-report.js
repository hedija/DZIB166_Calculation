const fs = require('fs');
const path = require('path');
const file = path.join(process.cwd(), 'test-report.json');
const json = JSON.parse(fs.readFileSync(file, 'utf8'));
const lines = [];
lines.push('# Detailed Test Report');
lines.push('');
lines.push('Generated from `test-report.json` produced by `npx vitest run --reporter=json --outputFile=test-report.json`');
lines.push('');
lines.push('## Summary');
lines.push('');
lines.push(`- Total test suites: ${json.numTotalTestSuites}`);
lines.push(`- Passed test suites: ${json.numPassedTestSuites}`);
lines.push(`- Failed test suites: ${json.numFailedTestSuites}`);
lines.push(`- Pending test suites: ${json.numPendingTestSuites}`);
lines.push(`- Total tests: ${json.numTotalTests}`);
lines.push(`- Passed tests: ${json.numPassedTests}`);
lines.push(`- Failed tests: ${json.numFailedTests}`);
lines.push(`- Pending tests: ${json.numPendingTests}`);
lines.push(`- Todo tests: ${json.numTodoTests}`);
lines.push('');
lines.push('## Suites and Test Cases');
lines.push('');
json.testResults.forEach(result => {
  lines.push(`### ${path.basename(result.name)}`);
  lines.push('');
  const suites = new Map();
  result.assertionResults.forEach(assertion => {
    const suiteName = assertion.ancestorTitles.join(' › ') || '(root)';
    if (!suites.has(suiteName)) suites.set(suiteName, []);
    suites.get(suiteName).push(assertion);
  });
  suites.forEach((assertions, suiteName) => {
    lines.push(`#### ${suiteName}`);
    lines.push('');
    assertions.forEach(assertion => {
      const statusIcon = assertion.status === 'passed' ? '✅' : assertion.status === 'failed' ? '❌' : '⚠️';
      const duration = typeof assertion.duration === 'number' ? `${assertion.duration.toFixed(2)}ms` : 'n/a';
      lines.push(`- ${statusIcon} **${assertion.title}** — ${duration}`);
      if (assertion.failureMessages && assertion.failureMessages.length) {
        lines.push('  - Failure:');
        assertion.failureMessages.forEach(msg => {
          msg.split('\n').forEach(line => lines.push(`    ${line}`));
        });
      }
    });
    lines.push('');
  });
});
fs.writeFileSync(path.join(process.cwd(), 'TEST-REPORT-DETAILED.md'), lines.join('\n'));
console.log('Created TEST-REPORT-DETAILED.md');

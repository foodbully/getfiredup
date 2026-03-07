/**
 * Canadian Retirement Planner - Core Logic & UI Bindings
 */

// ==========================================
// 1. Math & Tax Constants (2024 Ontario & Federal)
// ==========================================

const FED_BRACKETS_2024 = [
    { upTo: 55867, rate: 0.15 },
    { upTo: 111733, rate: 0.205 },
    { upTo: 173205, rate: 0.26 },
    { upTo: 246752, rate: 0.29 },
    { upTo: Infinity, rate: 0.33 }
];

const ONT_BRACKETS_2024 = [
    { upTo: 49231, rate: 0.0505 },
    { upTo: 98463, rate: 0.0915 },
    { upTo: 150000, rate: 0.1116 },
    { upTo: 220000, rate: 0.1216 },
    { upTo: Infinity, rate: 0.1316 }
];

// Basic Personal Amounts (roughly simplified to reduce initial taxable income to 0)
const FED_BPA_2024 = 15705;
const ONT_BPA_2024 = 12399;

const ELIGIBLE_DIVIDEND_GROSS_UP = 1.38;
const FED_DIVIDEND_TAX_CREDIT_RATE = 0.150198; // 15.0198% of grossed up amount
const ONT_DIVIDEND_TAX_CREDIT_RATE = 0.10; // 10% of grossed up amount
const CAPITAL_GAINS_INCLUSION_RATE = 0.5;

// ==========================================
// 2. Pure Functions: Tax & Drawdown Engine
// ==========================================

function calculateTaxBracketOwed(taxableIncome, brackets) {
    if (taxableIncome <= 0) return 0;

    let tax = 0;
    let remainingIncome = taxableIncome;
    let previousBracketLimit = 0;

    for (const bracket of brackets) {
        const bracketSize = bracket.upTo - previousBracketLimit;
        const incomeInBracket = Math.min(remainingIncome, bracketSize);

        if (incomeInBracket > 0) {
            tax += incomeInBracket * bracket.rate;
            remainingIncome -= incomeInBracket;
        }

        previousBracketLimit = bracket.upTo;

        if (remainingIncome <= 0) break;
    }

    return tax;
}

function calculateOntarioSurtax(baseOntarioTax) {
    let surtax = 0;
    if (baseOntarioTax > 5315) {
        surtax += (baseOntarioTax - 5315) * 0.20;
    }
    if (baseOntarioTax > 6802) {
        surtax += (baseOntarioTax - 6802) * 0.36;
    }
    return surtax;
}

function calculateTotalTax(regularIncome, capitalGains, actualEligibleDividends) {
    // 1. Calculate Grossed Up Income
    const grossedUpDividends = actualEligibleDividends * ELIGIBLE_DIVIDEND_GROSS_UP;
    const taxableCapitalGains = capitalGains * CAPITAL_GAINS_INCLUSION_RATE;
    const totalTaxableIncome = regularIncome + taxableCapitalGains + grossedUpDividends;

    // 2. Base Taxes
    const fedTaxBase = calculateTaxBracketOwed(totalTaxableIncome, FED_BRACKETS_2024);
    const ontTaxBase = calculateTaxBracketOwed(totalTaxableIncome, ONT_BRACKETS_2024);

    // 3. Non-Refundable Tax Credits (BPA + Dividend Tax Credits)
    const fedBpaCredit = FED_BPA_2024 * FED_BRACKETS_2024[0].rate;
    const ontBpaCredit = ONT_BPA_2024 * ONT_BRACKETS_2024[0].rate;

    const fedDtc = grossedUpDividends * FED_DIVIDEND_TAX_CREDIT_RATE;
    const ontDtc = grossedUpDividends * ONT_DIVIDEND_TAX_CREDIT_RATE;

    const fedTaxAfterCredits = Math.max(0, fedTaxBase - fedBpaCredit - fedDtc);
    const ontTaxAfterCredits = Math.max(0, ontTaxBase - ontBpaCredit - ontDtc);

    // 4. Ontario Surtax
    const ontSurtax = calculateOntarioSurtax(ontTaxAfterCredits);

    // We omit Ontario Health Premium for simplicity, but could add it later

    return fedTaxAfterCredits + ontTaxAfterCredits + ontSurtax;
}


// Estimates the gross amount needed to withdraw from a fully taxable source to hit a target net amount.
function calculateGrossNeededForNetRegularIncome(targetNet, currentRegularIncome, currentCapGains, currentDivs) {
    if (targetNet <= 0) return 0;

    let low = targetNet;
    let high = targetNet * 2.5;
    let bestGross = targetNet;

    for (let i = 0; i < 20; i++) {
        const midGross = (low + high) / 2;
        const totalTax = calculateTotalTax(currentRegularIncome + midGross, currentCapGains, currentDivs);
        const baseTax = calculateTotalTax(currentRegularIncome, currentCapGains, currentDivs);
        const marginalTaxPaid = totalTax - baseTax;

        const netYield = midGross - marginalTaxPaid;

        if (Math.abs(netYield - targetNet) < 0.5) {
            bestGross = midGross;
            break;
        }
        if (netYield < targetNet) low = midGross;
        else high = midGross;
    }
    return bestGross;
}

function runSimulation(inputs) {
    let {
        currentAge,
        retirementAge,
        lifeExpectancy,
        rrspBalance,
        tfsaBalance,
        nonRegBalance,
        nonRegCostBasisProvided, // fetch from inputs map
        annualSavingsRRSP,
        annualSavingsTFSA,
        annualSavingsNonReg,
        annualSpend,
        expectedReturn,
        dividendYield
    } = inputs;

    const totalReturnRate = expectedReturn / 100;
    const divYieldRate = dividendYield / 100;

    // Non-Reg Capital Return = Total Return - Dividend Yield. 
    // Prevent negative capital return if yield > total return just in case, though technically possible.
    const nonRegCapitalReturnRate = Math.max(0, totalReturnRate - divYieldRate);

    const yearlyData = [];

    // Cost basis tracking for exact capital gains. Cap it at current balance just in case user enters too high a number.
    let nonRegCostBasis = Math.min(nonRegBalance, nonRegCostBasisProvided);

    for (let age = currentAge; age <= lifeExpectancy; age++) {
        const isRetired = age >= retirementAge;

        let yearData = {
            age: age,
            rrspBalance: rrspBalance,
            tfsaBalance: tfsaBalance,
            nonRegBalance: nonRegBalance,
            totalBalance: rrspBalance + tfsaBalance + nonRegBalance,
            isRetired: isRetired,
            // Cashflow tracking
            dividendIncome: 0,
            withdrawalRRSP: 0,
            withdrawalTFSA: 0,
            withdrawalNonReg: 0, // Principal/Capital Gain draw
            taxPaid: 0,
            netIncome: 0,
            shortfall: 0
        };

        // 1. Process Growth & Contributions (Start of year)
        if (!isRetired) {
            rrspBalance += annualSavingsRRSP;
            tfsaBalance += annualSavingsTFSA;

            nonRegBalance += annualSavingsNonReg;
            nonRegCostBasis += annualSavingsNonReg;

            // Add reinvested dividends to the cost basis to avoid double-taxation later
            if (divYieldRate > 0) {
                const reinvestedDividends = nonRegBalance * divYieldRate;
                nonRegCostBasis += reinvestedDividends;
            }

            // Apply Growth
            // RRSP and TFSA grow by the exact Expected Total Return
            rrspBalance *= (1 + totalReturnRate);
            tfsaBalance *= (1 + totalReturnRate);

            // Pre-retirement Non-Reg grows by Total Return (dividends reinvested automatically)
            nonRegBalance *= (1 + totalReturnRate);
        } else {
            // 2. Process Drawdown (Retirement)
            let remainingSpendNeeded = annualSpend;

            let currentRegularIncome = 0;
            let currentCapGains = 0;
            let currentEligibleDivs = 0;
            let currentTaxesPaid = 0;

            // STRATEGY 1: Non-Reg Eligible Dividends Paid as Cashflow
            if (nonRegBalance > 0 && divYieldRate > 0) {
                const actualDividends = nonRegBalance * divYieldRate;
                currentEligibleDivs += actualDividends;

                // Calculate tax on just the dividends
                const taxOnDivs = calculateTotalTax(0, 0, currentEligibleDivs);
                currentTaxesPaid = taxOnDivs;

                const netYield = actualDividends - taxOnDivs;
                yearData.dividendIncome = actualDividends;
                yearData.taxPaid = taxOnDivs;
                yearData.netIncome += netYield;

                remainingSpendNeeded = Math.max(0, remainingSpendNeeded - netYield);
            }

            // STRATEGY 2: Non-Reg Drawdown (Principal + Capital Gains)
            if (remainingSpendNeeded > 0 && nonRegBalance > 0) {
                const ratioUnrealizedGains = Math.max(0, (nonRegBalance - nonRegCostBasis) / nonRegBalance);

                let low = remainingSpendNeeded;
                let high = remainingSpendNeeded * 1.5;
                let bestGross = remainingSpendNeeded;
                let actualCapitalGain = 0;

                for (let i = 0; i < 15; i++) {
                    const midGross = (low + high) / 2;
                    const gainPortion = midGross * ratioUnrealizedGains;

                    const totalTax = calculateTotalTax(currentRegularIncome, currentCapGains + gainPortion, currentEligibleDivs);
                    const marginalTax = totalTax - currentTaxesPaid;

                    const netYield = midGross - marginalTax;
                    if (Math.abs(netYield - remainingSpendNeeded) < 0.5) {
                        bestGross = midGross;
                        actualCapitalGain = gainPortion;
                        break;
                    }
                    if (netYield < remainingSpendNeeded) low = midGross;
                    else high = midGross;
                }

                const nrWithdrawal = Math.min(nonRegBalance, bestGross);
                const actualGain = nrWithdrawal * ratioUnrealizedGains;

                const taxTot = calculateTotalTax(currentRegularIncome, currentCapGains + actualGain, currentEligibleDivs);
                const marginalTax = taxTot - currentTaxesPaid;

                nonRegBalance -= nrWithdrawal;
                nonRegCostBasis -= (nrWithdrawal - actualGain);
                nonRegCostBasis = Math.max(0, nonRegCostBasis);

                yearData.withdrawalNonReg = nrWithdrawal;
                currentCapGains += actualGain;
                currentTaxesPaid = taxTot;
                yearData.taxPaid = taxTot;

                const netYield = nrWithdrawal - marginalTax;
                remainingSpendNeeded = Math.max(0, remainingSpendNeeded - netYield);
                yearData.netIncome += netYield;
            }

            // STRATEGY 3: TFSA (Tax free fallback)
            if (remainingSpendNeeded > 0 && tfsaBalance > 0) {
                const tfsaWithdrawal = Math.min(tfsaBalance, remainingSpendNeeded);
                tfsaBalance -= tfsaWithdrawal;
                yearData.withdrawalTFSA = tfsaWithdrawal;
                remainingSpendNeeded -= tfsaWithdrawal;
                yearData.netIncome += tfsaWithdrawal;
            }

            // STRATEGY 4: RRSP (Fully taxable)
            if (remainingSpendNeeded > 0 && rrspBalance > 0) {
                const addlGrossNeeded = calculateGrossNeededForNetRegularIncome(remainingSpendNeeded, currentRegularIncome, currentCapGains, currentEligibleDivs);
                const rrspWithdrawal = Math.min(rrspBalance, addlGrossNeeded);

                const taxTot = calculateTotalTax(currentRegularIncome + rrspWithdrawal, currentCapGains, currentEligibleDivs);
                const marginalTax = taxTot - currentTaxesPaid;

                rrspBalance -= rrspWithdrawal;
                yearData.withdrawalRRSP += rrspWithdrawal;

                currentRegularIncome += rrspWithdrawal;
                currentTaxesPaid = taxTot;
                yearData.taxPaid = taxTot;

                const netYield = rrspWithdrawal - marginalTax;
                remainingSpendNeeded = Math.max(0, remainingSpendNeeded - netYield);
                yearData.netIncome += netYield;
            }

            // Track Shortfall
            // The simulation's binary search is accurate to $0.50, so remaining spend might be e.g. $0.20
            // Clear floating point dust to avoid triggering "Funds Depleted" incorrectly.
            if (remainingSpendNeeded < 1.0) remainingSpendNeeded = 0;
            yearData.shortfall = remainingSpendNeeded;

            // Apply Capital Growth to remaining balances
            rrspBalance *= (1 + totalReturnRate);
            tfsaBalance *= (1 + totalReturnRate);
            nonRegBalance *= (1 + nonRegCapitalReturnRate);
        }

        yearlyData.push(yearData);

        rrspBalance = Math.max(0, rrspBalance);
        tfsaBalance = Math.max(0, tfsaBalance);
        nonRegBalance = Math.max(0, nonRegBalance);
    }

    return yearlyData;
}


// ==========================================
// 3. UI, State, and Charting
// ==========================================

let balanceChartInstance = null;
let cashflowChartInstance = null;

const THEME_COLORS = {
    rrsp: '#3b82f6',
    tfsa: '#14b8a6',
    nonReg: '#8b5cf6',
    tax: '#f43f5e',
    shortfall: '#ef4444',
    dividend: '#fbbf24' // amber 400 for dividends
};

function parseCurrency(val) {
    if (!val) return 0;
    return Number(val.replace(/[^0-9.-]+/g, ""));
}

function formatCurrency(val) {
    return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(val);
}

// Input formatting
document.querySelectorAll('.currency-format').forEach(input => {
    // Format on load
    if (input.value) input.value = Number(input.value).toLocaleString('en-CA');

    input.addEventListener('blur', function () {
        if (this.value) {
            const num = parseCurrency(this.value);
            this.value = num.toLocaleString('en-CA');
        }
    });

    input.addEventListener('focus', function () {
        if (this.value) {
            this.value = parseCurrency(this.value);
        }
    });
});

function getInputs() {
    return {
        currentAge: parseInt(document.getElementById('currentAge').value) || 35,
        retirementAge: parseInt(document.getElementById('retirementAge').value) || 65,
        lifeExpectancy: parseInt(document.getElementById('lifeExpectancy').value) || 90,
        rrspBalance: parseCurrency(document.getElementById('rrspBalance').value),
        tfsaBalance: parseCurrency(document.getElementById('tfsaBalance').value),
        nonRegBalance: parseCurrency(document.getElementById('nonRegBalance').value),
        nonRegCostBasisProvided: parseCurrency(document.getElementById('nonRegCostBasis').value),
        annualSavingsRRSP: parseCurrency(document.getElementById('annualSavingsRRSP').value),
        annualSavingsTFSA: parseCurrency(document.getElementById('annualSavingsTFSA').value),
        annualSavingsNonReg: parseCurrency(document.getElementById('annualSavingsNonReg').value),
        annualSpend: parseCurrency(document.getElementById('annualSpend').value),
        expectedReturn: isNaN(parseFloat(document.getElementById('expectedReturn').value)) ? 6.0 : parseFloat(document.getElementById('expectedReturn').value),
        dividendYield: isNaN(parseFloat(document.getElementById('dividendYield').value)) ? 3.0 : parseFloat(document.getElementById('dividendYield').value)
    };
}

const STORAGE_KEY = 'canadian_retirement_inputs';

function saveInputsToStorage(inputs) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(inputs));
}

function loadInputsFromStorage() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return false;

    try {
        const inputs = JSON.parse(stored);

        document.getElementById('currentAge').value = inputs.currentAge;
        document.getElementById('retirementAge').value = inputs.retirementAge;
        document.getElementById('lifeExpectancy').value = inputs.lifeExpectancy;

        document.getElementById('rrspBalance').value = formatCurrency(inputs.rrspBalance);
        document.getElementById('tfsaBalance').value = formatCurrency(inputs.tfsaBalance);
        document.getElementById('nonRegBalance').value = formatCurrency(inputs.nonRegBalance);
        document.getElementById('nonRegCostBasis').value = formatCurrency(inputs.nonRegCostBasisProvided);

        document.getElementById('annualSavingsRRSP').value = formatCurrency(inputs.annualSavingsRRSP);
        document.getElementById('annualSavingsTFSA').value = formatCurrency(inputs.annualSavingsTFSA);
        document.getElementById('annualSavingsNonReg').value = formatCurrency(inputs.annualSavingsNonReg);
        document.getElementById('annualSpend').value = formatCurrency(inputs.annualSpend);

        document.getElementById('expectedReturn').value = inputs.expectedReturn;
        document.getElementById('dividendYield').value = inputs.dividendYield;

        return true;
    } catch (e) {
        console.error("Error loading inputs from storage", e);
        return false;
    }
}

function resetToDefaults() {
    localStorage.removeItem(STORAGE_KEY);
    // Reload the page to reset all HTML values back to their hardcoded defaults
    window.location.reload();
}

function updateCharts(data, inputs) {
    const labels = data.map(d => d.age);

    // 1. Balance Chart (Stacked Area)
    const ctxBalance = document.getElementById('balanceChart').getContext('2d');

    if (balanceChartInstance) balanceChartInstance.destroy();

    balanceChartInstance = new Chart(ctxBalance, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Non-Registered',
                    data: data.map(d => d.nonRegBalance),
                    borderColor: THEME_COLORS.nonReg,
                    backgroundColor: THEME_COLORS.nonReg + '80', // 50% opacity
                    fill: true,
                    tension: 0.4
                },
                {
                    label: 'TFSA',
                    data: data.map(d => d.tfsaBalance),
                    borderColor: THEME_COLORS.tfsa,
                    backgroundColor: THEME_COLORS.tfsa + '80',
                    fill: true,
                    tension: 0.4
                },
                {
                    label: 'RRSP / LIRA',
                    data: data.map(d => d.rrspBalance),
                    borderColor: THEME_COLORS.rrsp,
                    backgroundColor: THEME_COLORS.rrsp + '80',
                    fill: '-1', // Fill to previous dataset
                    tension: 0.4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { stacked: true, grid: { color: 'rgba(255,255,255,0.05)' }, title: { display: true, text: 'Age', color: '#94a3b8' } },
                y: {
                    stacked: true,
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { callback: (val) => '$' + (val / 1000) + 'k' }
                }
            },
            plugins: {
                legend: { labels: { color: '#f8fafc', font: { family: 'Inter' } } },
                tooltip: {
                    mode: 'index',
                    callbacks: {
                        label: function (context) {
                            let label = context.dataset.label || '';
                            if (label) label += ': ';
                            if (context.parsed.y !== null) {
                                label += new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(context.parsed.y);
                            }
                            return label;
                        }
                    }
                }
            }
        }
    });

    // 2. Cashflow Chart (Stacked Bar for Retirement Years)
    const retirementData = data.filter(d => d.isRetired);
    const retLabels = retirementData.map(d => d.age);

    const ctxCashflow = document.getElementById('cashflowChart').getContext('2d');

    if (cashflowChartInstance) cashflowChartInstance.destroy();

    cashflowChartInstance = new Chart(ctxCashflow, {
        type: 'bar',
        data: {
            labels: retLabels,
            datasets: [
                {
                    label: 'Eligible Dividends',
                    data: retirementData.map(d => d.dividendIncome),
                    backgroundColor: THEME_COLORS.dividend,
                },
                {
                    label: 'RRSP Withdrawal',
                    data: retirementData.map(d => d.withdrawalRRSP),
                    backgroundColor: THEME_COLORS.rrsp,
                },
                {
                    label: 'TFSA Withdrawal',
                    data: retirementData.map(d => d.withdrawalTFSA),
                    backgroundColor: THEME_COLORS.tfsa,
                },
                {
                    label: 'Non-Reg Withdrawal',
                    data: retirementData.map(d => d.withdrawalNonReg),
                    backgroundColor: THEME_COLORS.nonReg,
                },
                {
                    label: 'Estimated Tax Paid',
                    data: retirementData.map(d => -d.taxPaid), // Negative to show below line
                    backgroundColor: THEME_COLORS.tax,
                },
                {
                    label: 'Income Shortfall',
                    data: retirementData.map(d => d.shortfall),
                    backgroundColor: THEME_COLORS.shortfall,
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { stacked: true, grid: { color: 'rgba(255,255,255,0.05)' }, title: { display: true, text: 'Retirement Age', color: '#94a3b8' } },
                y: {
                    stacked: true,
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { callback: (val) => '$' + (Math.abs(val) / 1000) + 'k' }
                }
            },
            plugins: {
                legend: { labels: { color: '#f8fafc', font: { family: 'Inter' } } },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        label: function (context) {
                            let label = context.dataset.label || '';
                            if (label) label += ': ';
                            if (context.parsed.y !== null) {
                                label += new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(Math.abs(context.parsed.y));
                            }
                            return label;
                        }
                    }
                }
            }
        }
    });

    // 3. Update Summary Cards
    const retirementNode = data.find(d => d.age === inputs.retirementAge);
    if (retirementNode) {
        document.getElementById('projectedTotal').textContent = formatCurrency(retirementNode.totalBalance);
    }

    const totalShortfall = retirementData.reduce((sum, d) => sum + d.shortfall, 0);
    const statusCard = document.getElementById('successCard');
    const statusText = document.getElementById('planStatus');

    if (totalShortfall > 0) {
        statusCard.className = 'card status-card status-warning';
        statusText.textContent = 'Funds Depleted Early';
    } else {
        statusCard.className = 'card status-card status-good';
        statusText.textContent = 'Fully Funded';
    }
}

function renderTable(data) {
    const tbody = document.querySelector('#dataTable tbody');
    tbody.innerHTML = '';

    data.forEach(row => {
        const tr = document.createElement('tr');
        if (row.isRetired) tr.classList.add('row-retired');

        tr.innerHTML = `
            <td>${row.age}</td>
            <td>${formatCurrency(row.totalBalance)}</td>
            <td style="color: ${THEME_COLORS.rrsp}">${formatCurrency(row.rrspBalance)}</td>
            <td style="color: ${THEME_COLORS.tfsa}">${formatCurrency(row.tfsaBalance)}</td>
            <td style="color: ${THEME_COLORS.nonReg}">${formatCurrency(row.nonRegBalance)}</td>
            
            <td style="color: ${THEME_COLORS.dividend}">${row.dividendIncome > 0 ? formatCurrency(row.dividendIncome) : '-'}</td>
            <td style="color: ${THEME_COLORS.rrsp}">${row.withdrawalRRSP > 0 ? formatCurrency(row.withdrawalRRSP) : '-'}</td>
            <td style="color: ${THEME_COLORS.tfsa}">${row.withdrawalTFSA > 0 ? formatCurrency(row.withdrawalTFSA) : '-'}</td>
            <td style="color: ${THEME_COLORS.nonReg}">${row.withdrawalNonReg > 0 ? formatCurrency(row.withdrawalNonReg) : '-'}</td>
            <td style="color: ${THEME_COLORS.tax}">${row.taxPaid > 0 ? formatCurrency(row.taxPaid) : '-'}</td>
        `;

        tbody.appendChild(tr);
    });
}

function handleCalculate() {
    const inputs = getInputs();
    const retireAgeError = document.getElementById('retireAgeError');
    const lifeExpError = document.getElementById('lifeExpError');

    // Clear any previous errors
    retireAgeError.classList.add('hidden');
    lifeExpError.classList.add('hidden');

    // Basic validation
    if (inputs.retirementAge <= inputs.currentAge) {
        retireAgeError.textContent = "Must be > current age.";
        retireAgeError.classList.remove('hidden');
        return;
    }
    if (inputs.lifeExpectancy <= inputs.retirementAge) {
        lifeExpError.textContent = "Must be > retirement age.";
        lifeExpError.classList.remove('hidden');
        return;
    }

    // Auto-save on valid calculate
    saveInputsToStorage(inputs);

    const simData = runSimulation(inputs);
    updateCharts(simData, inputs);
    renderTable(simData);
}

// Bind events
document.getElementById('calculateBtn').addEventListener('click', handleCalculate);
document.getElementById('resetBtn').addEventListener('click', resetToDefaults);

// Auto-calculate on input change
document.querySelectorAll('input').forEach(input => {
    // Only calculate on 'blur' (when the user clicks away) to prevent aggressive 
    // validation alerts while they are mid-typing (e.g. typing "48" stopping at "4")
    input.addEventListener('blur', handleCalculate);
});

// Initial run
window.onload = () => {
    loadInputsFromStorage(); // Attempt to load saved data first
    handleCalculate();       // Then run math engine to populate display
};

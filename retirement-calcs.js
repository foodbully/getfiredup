// =================
// === CONSTANTS ===
// =================

const FED_BRACKETS_2024 = [
    { upTo: 55867, rate: 0.15 },
    { upTo: 111733, rate: 0.205 },
    { upTo: 173205, rate: 0.26 },
    { upTo: 246752, rate: 0.29 },
    { upTo: Infinity, rate: 0.33 }
];

const TAX_BRACKETS_AB = []

const PROVINCIAL_TAX_DATA = {
    AB: {
        name: "Alberta",
        bpa: 21885,
        dtcRate: 0.1013,
        brackets: [
            { upTo: 148269, rate: 0.10 },
            { upTo: 177922, rate: 0.12 },
            { upTo: 237230, rate: 0.13 },
            { upTo: 355845, rate: 0.14 },
            { upTo: Infinity, rate: 0.15 }
        ]
    },
    BC: {
        name: "British Columbia",
        bpa: 12580,
        dtcRate: 0.12,
        brackets: [
            { upTo: 47937, rate: 0.0506 },
            { upTo: 95875, rate: 0.0770 },
            { upTo: 110076, rate: 0.1050 },
            { upTo: 133664, rate: 0.1229 },
            { upTo: 181232, rate: 0.1470 },
            { upTo: 252752, rate: 0.1680 },
            { upTo: Infinity, rate: 0.2050 }
        ]
    },
    SK: {
        name: "Saskatchewan",
        bpa: 18491,
        dtcRate: 0.11,
        brackets: [
            { upTo: 52057, rate: 0.1050 },
            { upTo: 148734, rate: 0.1250 },
            { upTo: Infinity, rate: 0.1450 }
        ]
    },
    ON: {
        name: "Ontario",
        bpa: 12399,
        dtcRate: 0.10,
        brackets: [
            { upTo: 49231, rate: 0.0505 },
            { upTo: 98463, rate: 0.0915 },
            { upTo: 150000, rate: 0.1116 },
            { upTo: 220000, rate: 0.1216 },
            { upTo: Infinity, rate: 0.1316 }
        ]
    }
};

const ELIGIBLE_DIVIDEND_GROSS_UP = 1.38;
const FED_DIVIDEND_TAX_CREDIT_RATE = 0.150198;
const CAPITAL_GAINS_INCLUSION_RATE = 0.5;


// =================
// === FUNCTIONS ===
// =================

#!/usr/bin/env python3
"""Build jamb-accounting-decade.jsonl from genuine edupadi.com JAMB accounting past questions.

Every question below was transcribed verbatim from edupadi.com year-tagged pages
(https://edupadi.com/classroom/lessons/jamb/accounts/<YEAR>/page/<N>). The "answer"
letter is exactly the page's stated "Correct Answer". Questions whose data lived only
in an image or a garbled HTML table, or where the page's own answer key contradicted
its worked explanation, were DISCARDED (not invented/repaired).
"""
import json, os

OUT = "/Users/mitchellagoma/Documents/exam-prep-agent/data/scraped/jamb-accounting-decade.jsonl"

Q = []
def add(year, topic, text, a, b, c, d, ans, expl=""):
    Q.append({
        "subject": "accounting", "exam": "jamb", "year": year, "topic": topic,
        "source": "past", "difficulty": 2, "text": text,
        "options": {"A": a, "B": b, "C": c, "D": d}, "answer": ans,
        "explanation": expl,
    })

# ---------------- 2016 (page 1) ----------------
add(2016, "double entry", "The major advantage of the journal proper is that it",
    "helps in the preparation of the balance sheet",
    "prevents fraud and theft of item of the business",
    "serves as a book of instruction to the bookkeeper",
    "help the banking industry to be efficient", "B")
add(2016, "accounting concepts", "One of the objectives of accounting is that it can be used for",
    "business decision making", "due process in business",
    "motivating employees", "determining the work force", "A")
add(2016, "ratios", "The ratio that gives the indication of the efficiency of a firm's sales with respect to cost of goods sold is a",
    "return on capital employed", "gross profit margin",
    "net profit margin", "return on equity", "A")
add(2016, "financial statements", "The instrument used in analysis and interpretation of financial statement is the",
    "accounting ratios", "income and expenditure extract",
    "balance sheet extract", "found accounting", "A")
add(2016, "final accounts", "An item in the balance sheet of a limited liability company is",
    "accrued expenses", "lighting and heating",
    "salaries and wages", "general expenses", "A")
add(2016, "banking", "The documents that provide instant information to firms on their transactions with banks are",
    "bank statement and debit note", "cheque book and cashbook",
    "cheque stub and deposit slip", "payslip and credit invoice", "A")
add(2016, "company accounts", "Which of the following is the capital reserve of a company?",
    "Accumulated depreciation", "Retained profit",
    "Share premium", "Loss on forfeited shares", "B")

# ---------------- 2017 (page 1) ----------------
add(2017, "partnership", "Which of these accounts is dissolution expenses credited?",
    "partners capital account", "revaluation account",
    "partners current account", "Realization account", "D",
    "Realization account: the cash realized from sales of asset is credited to it")
add(2017, "company accounts", "Capital for a profit making organization is generated through",
    "Subscription", "shares", "donation", "gift", "B",
    "Profit making organizations use different shares such as ordinary and preference shares to source for money from the public")
add(2017, "partnership", "The account where the profit are distributed to the partner in their profit sharing ratio in partnership",
    "trading account", "appropriation account",
    "balance sheet", "profit and loss account", "B",
    "Appropriation account is the account into which the net profit found in the profit and loss account of the partner will be carried down to and shared according to their sharing ratio")
add(2017, "manufacturing accounts", "In manufacturing account, depreciation of office machine is charged to",
    "trading account", "appropriation account",
    "balance street", "profit and loss account", "D",
    "Depreciation of office machines is charged to the profit and loss account because it is an administrative expense")
add(2017, "government accounting", "Which fund is used to meet unforeseen or urgent expenditure",
    "General reserve fund", "Consolidated Reserve Fund",
    "contingencies fund", "special fund", "B")
add(2017, "stock valuation", "In the period of rising prices, which method of stock valuation is most appropriate?",
    "Last in First Out", "weighted average",
    "First in First Out", "Simple average", "A")
add(2017, "subsidiary books", "Which of these is the subsidiary book for return inwards?",
    "Sales day book", "Sales return journal",
    "Purchases day journal", "Cash book", "B",
    "The subsidiary book for return inwards (sales returns) is the Sales Return Journal")
add(2017, "cash book", "A double entry for a transaction that offsets one amount against another on both sides of the cashbook is a",
    "original entry", "contra entry", "prime entry", "contract entry", "B",
    "A contra entry is used to offset an amount or same transaction against another on both sides of the cashbook")

# ---------------- 2018 (page 1) ----------------
add(2018, "departmental accounts", "Advertising expenses incurred on a product in a business organization should be charged to",
    "Sales department", "Production department",
    "Purchase department", "Administration department", "A",
    "It is an expense incurred in order to enhance the sales of the company's product or services")
add(2018, "branch accounts", "When goods are sent to branch at cost plus mark up, it means that the branch should sell at",
    "Price above or below the stipulated price", "Any price but not below the transfer price",
    "Cost price", "A price that is equal to the mark up", "A")
add(2018, "government accounting", "The office responsible for ascertaining whether all public expenditures and appropriations are in line with approved guidelines is the",
    "Accountant general", "Finance minister",
    "Auditor general", "Permanent secretary", "C")
add(2018, "company accounts", "The amount called in respect of a share but not paid before or on the date fixed for payment is referred to as",
    "Call in advance", "call in arrears", "forfeiture", "shares", "B",
    "Call in arrears is the amount called by the company which is not paid by the shareholders before the due date fixed for payment")

# ---------------- 2019 (page 1) ----------------
add(2019, "double entry", "Transactions are recorded or posted to the ledger in line with",
    "Accounting Concept", "Source document",
    "Double Entry Principle", "Data collection", "C",
    "Under the double-entry system, for every debit there is a corresponding credit for an equal amount, and vice versa")
add(2019, "double entry", "Show how the following transaction will be recorded applying the double-entry principle: Rent N50,000 was paid by Mr. Roi to his landlord on 1st July by cheque.",
    "Dr Rent A/c; Dr Bank A/c", "Dr Bank A/c; Cr Rent A/c",
    "Dr Rent A/c; Cr Bank A/c", "Dr Rent A/c; Cr Mr. Roi", "C",
    "Rent account is debited and bank account is credited (money has gone out via the cheque)")
add(2019, "ledger", "A statement in a double-entry system in which are recorded all the transactions of one specific class, which takes place during the period is called",
    "Double entry system", "Ledger", "Cash Book", "Petty Cash Book", "B")
add(2019, "double entry", "Accounts can be classified into",
    "cash and credit transactions", "cash and credit accounts",
    "personal and private account", "personal and impersonal account", "D",
    "Personal accounts are for individuals (debtors, creditors, banks, capital, drawings); impersonal accounts are not held in the name of persons")
add(2019, "double entry", "Goods were purchased for resale on credit costing N150,000 on 30th September from Tosanwumi International. The entry to record this transaction is debit",
    "Tosanwumi International, credit purchase Account",
    "Purchase Account N150,000, credit Tosanwumi International Account N150,000",
    "Credit Account N150,000, Credit Tosanwumi International N150,000",
    "Tosanwumi International N150,000, credit credit Account N150,000", "B",
    "The purchase account is debited while the Tosanwumi International account is credited")
add(2019, "final accounts", "If only wages is shown on the trial balance, it should be charged to the",
    "profit and loss account", "trading account",
    "balance sheet", "wages account", "A")

# ---------------- 2020 (page 1) ----------------
add(2020, "branches of accounting", "Which of the following branches of accounting was first developed?",
    "Cost accounting", "Financial accounting",
    "Management accounting", "Petroleum accounting", "B")
add(2020, "control accounts", "The purchase ledger control account of a company had an opening balance of N45,600 credit and closing balance of N72,600 credit. The company made payments of N437,000 to credit suppliers during the period and had discount received of N18,600 on this account. What were the credit purchases for the period?",
    "N509,600", "N482,600", "N428,600", "N418,400", "B")
add(2020, "source documents", "Which of the following accounting records are source documents?",
    "Journal and ledgers", "Sales invoice and cash book",
    "Cash book and debit note", "sales invoice and debit note", "D")
add(2020, "cash book", "Petty cash book records transactions on",
    "the debit side only", "the credit side only",
    "both credit and debit sides", "reversed entry", "C")
add(2020, "bills of exchange", "When a bill is negotiated to a bank, it is said to be",
    "surrendered", "cashed", "discounted", "accepted", "C")
add(2020, "company accounts", "The main difference between the ordinary and preference shareholders is that",
    "the former receive dividends while the latter do not",
    "the latter are not members of the company while the former are",
    "in the case of winding up, the former are paid first before the latter",
    "the former have voting rights while the latter do not", "D")
add(2020, "incomplete records", "Given an incomplete record without sufficient information to determine profit, the necessary thing to do is to",
    "draw up the statement of affairs", "draw up a T-account to establish the amount",
    "compare the journal entries with the cash book", "cross-check the cash book for further information", "A")
add(2020, "single entry", "Keeping records under the single entry system has the advantage of",
    "quality in terms of records", "completeness in terms of records",
    "accuracy in terms of operation", "simplicity in terms of operation", "D")

# ---------------- 2020 (page 2) ----------------
add(2020, "accounting concepts", "Accounting information is used by investors and creditors of a company to predict",
    "future cash flows of the company", "future tax payments of the company",
    "potential merger candidates for the company", "appropriate remunerations for the company's staff", "A")
add(2020, "control accounts", "The principal use of control accounts is to",
    "localize error within the ledger", "prevent fraud",
    "increase sales", "record assets and liabilities", "A")
add(2020, "government accounting", "Which of the following is a signatory to federal government account?",
    "Auditor-General", "Governor of Central Bank",
    "Accountant-General", "President", "C")
add(2020, "government accounting", "An instrument which allows public officers to increase expenditure within a year is",
    "statutory allocation", "supplementary budget",
    "virement", "warrant", "B")
add(2020, "company accounts", "The debenture issued at par above the nominal value is said to be issued at a",
    "cost price", "mark-up", "premium", "margin", "C")
add(2020, "branch accounts", "Which of the following methods of invoicing goods to branches facilitate easy checks on the activities of branches?",
    "cost price", "fixed percentage on cost",
    "selling price", "invoice price", "A")
add(2020, "double entry", "The correct posting in a double entry system of account when there is an increase in assets, expenses, capital or liabilities is to debit",
    "capital and debit liabilities", "liabilities and credit assets",
    "assets and credit capital", "capital and credit assets", "C")

# ---------------- 2021 (page 1) ----------------
add(2021, "control accounts", "Sales ledger control account contains the total amount in respect of",
    "investors", "creditors", "shareholders", "debtors", "D")
add(2021, "stock valuation", "Which of the following stock valuation method is suitable under inflationary conditions?",
    "LIFO", "simple average", "FIFO", "weighted average", "C",
    "Under inflationary conditions, FIFO assumes the oldest stock is sold first, resulting in a higher valuation of the remaining stock")
add(2021, "company accounts", "The ordinary shareholders enjoy the following rights except the right to",
    "receive dividends at a predetermined rate", "vote at annual general meetings",
    "elect the board of directors", "participate in additional issues of shares", "A")
add(2021, "non-profit accounts", "The excess of income over expenditure is usually transferred to the",
    "current assets in the balance sheet", "profit and loss account",
    "accumulated fund", "current liabilities in the balance sheet", "C")
add(2021, "departmental accounts", "In a departmental accounting system, which of the following expenses will most likely be apportioned on the basis of turnover",
    "carriage inwards", "carriage outwards",
    "discount received", "returns outwards", "B")

# ---------------- 2021 (page 2) ----------------
add(2021, "accounting concepts", "The accounting method that reports incomes when earned and expenses when incurred is called",
    "accrual accounting", "cash accounting",
    "fund accounting", "commitment accounting", "A")
add(2021, "accounting concepts", "Stationery which will be used over a long period of time is usually recorded as an expense instead of an asset. This concept is called",
    "entity", "accrual", "realization", "materiality", "D")
add(2021, "stock valuation", "If a company values its stock in the period of rising prices using LIFO method, there is a tendency for it to",
    "have a higher cost of goods sold", "have a higher value of closing stock",
    "have a higher gross profit", "pay higher income tax", "C")
add(2021, "departmental accounts", "The major objective of departmental account is to ascertain the",
    "materials sold in each department", "insurance premium payable on employees",
    "number of employees in each department", "contribution of each department to profit", "D")
add(2021, "company accounts", "Given: i. The memorandum of association of the company ii. The article of association of the company iii. The incorporation documents. Which of the following is delivered to the registrar of companies for incorporation?",
    "i, ii and iii", "i and ii", "i and iii", "ii and iii", "A")

# ---------------- 2022 (page 1) ----------------
add(2022, "stock valuation", "Which of the following stock valuation method is suitable under inflationary conditions?",
    "LIFO", "simple average", "FIFO", "weighted average", "C",
    "Under inflationary conditions, FIFO assumes the oldest stock is sold first, resulting in a higher valuation of remaining stock")
add(2022, "government accounting", "An evidence of payment issued to a government ministry by a revenue collector is",
    "treasury receipt", "receipt voucher",
    "payment voucher", "treasury card", "A",
    "A treasury receipt serves as proof of payment made to the government and is an official record of the transaction")
add(2022, "branch accounts", "Transfers from the head office to branches are best carried out at",
    "Cost price", "Cost plus mark up",
    "Selling price", "Market price", "B",
    "Cost plus mark up ensures that the branch covers both the cost and makes a profit")
add(2022, "partnership", "A partnership's internal regulations are set out by",
    "A constitution", "A law", "A deed", "An article", "C",
    "A partnership's internal regulations are typically set out in a deed outlining rights, responsibilities and terms")
add(2022, "bank reconciliation", "In a bank reconciliation statement, dishonoured cheques is added to",
    "unpresented cheques", "uncredited cheques",
    "statement of account", "aggregate balance as per cash book", "B")
add(2022, "company accounts", "One of the items listed below will not be found in a company's memorandum and article of association. Which is it?",
    "objects and their alteration", "location of business",
    "bank signatories", "powers of directors", "C",
    "Bank signatories relate to internal financial operations decided by directors and recorded separately, not in the memorandum and articles")
add(2022, "partnership", "The major distinguishing element between the final account of a partnership and that of a sole trader is the",
    "drawing A/C", "capital A/C", "Creditor A/C", "Appropriation A/C", "D",
    "A partnership includes an Appropriation Account showing how profit is distributed among partners")
add(2022, "partnership dissolution", "To realize an asset means to",
    "mortgage it", "open its account in the ledger",
    "turn it to cash", "give it out as a collateral", "C")

# ---------------- 2023 (page 1) ----------------
add(2023, "non-profit accounts", "One of the options below have the same features as the profit and loss account in non-profit organization",
    "non profit account", "profit and loss account",
    "income and expenditure account", "receipts and payment account", "C",
    "The income and expenditure account in a non-profit organization serves the same function as the profit and loss account in a for-profit organization")
add(2023, "final accounts", "Salaries in arrears is treated in the balance sheet as a",
    "current asset", "current liability",
    "long term liability", "fixed asset", "B",
    "Salaries in arrears are amounts owed to employees expected to be paid in the near future, so they are a current liability")
add(2023, "stock valuation", "An advantage of FIFO method of stock valuation is that",
    "it is calculated at the end of the year", "its flow of cost is in sequence with the flow of stock",
    "it is progressive in nature", "it serves as a control during inflation", "B")
add(2023, "source documents", "Which of these is the main source document for recording cash paid into bank?",
    "invoice", "credit note", "cheque book", "pay-in-slip", "D",
    "The pay-in-slip is used to deposit money into a bank account and serves as proof of the transaction")
add(2023, "government accounting", "The authority warrant issued prior to the approval of the appropriate bill at the beginning of the year",
    "contingencies", "reserved expenditure warrant",
    "annual general warrant", "provisional general warrant", "D",
    "A provisional general warrant authorises spending before the approval of the appropriate bill at the beginning of the year")
add(2023, "government accounting", "The authority to transfer fund from one head to another within the same organization is called",
    "fund", "warrant", "vote", "virement", "D")
add(2023, "partnership", "Goodwill can be introduced when",
    "the business suffers high loss", "the business is being expanded",
    "the partnership experience super profit", "a new member is admitted", "D",
    "Goodwill can be introduced when a new partner is admitted, as it changes the partnership's value and earning capacity")

# ---------------- 2024 (page 1) ----------------
# Kept only items where the page's answer letter is internally consistent & question is self-contained.
add(2024, "accounting equation", "The amount by which assets exceed liabilities is",
    "capital", "premium", "bonus", "provision", "A",
    "From Assets = Liabilities + Owner's Equity, the difference between assets and liabilities represents capital")
add(2024, "partnership", "Where there is no partnership agreement, a partner who advances a loan to the partnership is entitled to ____ interest.",
    "2%", "15%", "10%", "5%", "D",
    "In the absence of a partnership agreement, the legally recognized interest rate on a partner's loan is 5% per annum")
add(2024, "final accounts", "The following balances were extracted from the books of Onuoha, a trader, on 31st December 2005: Audit fee 12000; General expenses 30000; Purchases 70000; Commission paid 30000; Stock (01-01-2005) 10000; Stock (31-12-2005) 15000; Sales 120000. The gross profit is",
    "#35,000", "#45,000", "#55,000", "#25,000", "C",
    "COGS = Opening Stock + Purchases - Closing Stock = 10,000 + 70,000 - 15,000 = 65,000; Gross Profit = Sales - COGS = 120,000 - 65,000 = 55,000")
add(2024, "depreciation", "Depreciation is",
    "an appropriation of profit", "estimated life of an asset",
    "loss in the value of fixed asset", "increase in asset value", "C",
    "Depreciation is the reduction in the value of a fixed asset due to wear and tear, usage, obsolescence or the passage of time")

# ---- de-dup + balance ----
# 1) drop exact-duplicate questions across years (keep earliest year) by question text alone
# 2) cap per-year so the catch is spread (target <= 60 total)
PER_YEAR_CAP = 7
seen_text = set()
by_year = {}
clean = []
for q in sorted(Q, key=lambda x: x["year"]):
    # final sanity: 4 non-empty options + answer in A-D + non-trivial text + in-range year
    if not (all(q["options"][k].strip() for k in "ABCD")
            and q["answer"] in {"A", "B", "C", "D"}
            and len(q["text"].strip()) > 12
            and 2016 <= q["year"] <= 2025):
        continue
    tkey = q["text"].strip().lower()
    if tkey in seen_text:          # identical question repeated in another year -> skip
        continue
    if by_year.get(q["year"], 0) >= PER_YEAR_CAP:
        continue
    seen_text.add(tkey)
    by_year[q["year"]] = by_year.get(q["year"], 0) + 1
    clean.append(q)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as f:
    for q in clean:
        f.write(json.dumps(q, ensure_ascii=False) + "\n")

from collections import Counter
yc = Counter(q["year"] for q in clean)
print("written:", len(clean))
print("years:", dict(sorted(yc.items())))

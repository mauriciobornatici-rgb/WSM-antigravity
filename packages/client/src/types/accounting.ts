export interface ChartAccount {
    code: string
    name: string
    type: "asset" | "liability" | "equity" | "revenue" | "expense"
    active: boolean
    total_debit: number
    total_credit: number
    balance: number
}

export interface JournalEntryLine {
    id: string
    account_code: string
    account_name: string
    account_type: string
    debit: number
    credit: number
    notes: string
}

export interface JournalEntry {
    id: string
    entry_number: number
    date: string
    description: string
    reference_type: string
    reference_id: string
    lines: JournalEntryLine[]
}

export interface TrialBalanceItem {
    code: string
    name: string
    type: string
    initial_balance: number
    debit: number
    credit: number
    final_balance: number
}

export interface IncomeStatementData {
    revenues: Array<{ code: string; name: string; balance: number }>
    expenses: Array<{ code: string; name: string; balance: number }>
    total_revenues: number
    total_expenses: number
    net_result: number
}

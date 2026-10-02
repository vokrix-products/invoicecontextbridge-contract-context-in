import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(url, anonKey)

export const PRODUCT_ID = import.meta.env.VITE_PRODUCT_ID || 'invoicecontextbridge-contract-context-in'
export const PRODUCT_NAME = import.meta.env.VITE_PRODUCT_NAME || 'InvoiceContextBridge'
export const PRODUCT_DESCRIPTION = import.meta.env.VITE_PRODUCT_DESCRIPTION || ''
export const PAYWALL_TITLE = import.meta.env.VITE_PAYWALL_TITLE || 'You have used your free Invoice Lines'
export const PAYWALL_DESCRIPTION = import.meta.env.VITE_PAYWALL_DESCRIPTION || 'Upgrade to get unlimited Invoice Lines.'

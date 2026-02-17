export type Json =
    | string
    | number
    | boolean
    | null
    | { [key: string]: Json | undefined }
    | Json[]

export interface Database {
    public: {
        Tables: {
            products: {
                Row: {
                    id: string
                    sku: string
                    name: string
                    description: string | null
                    category: string | null
                    image_url: string | null
                    purchase_price: number
                    sale_price: number
                    created_at: string
                }
                Insert: {
                    id?: string
                    sku: string
                    name: string
                    description?: string | null
                    category?: string | null
                    image_url?: string | null
                    purchase_price?: number
                    sale_price?: number
                    created_at?: string
                }
                Update: {
                    id?: string
                    sku?: string
                    name?: string
                    description?: string | null
                    category?: string | null
                    image_url?: string | null
                    purchase_price?: number
                    sale_price?: number
                    created_at?: string
                }
            }
            inventory: {
                Row: {
                    id: string
                    variant_id: string
                    location: string
                    quantity: number
                    min_stock_level: number
                    updated_at: string
                }
            }
        }
    }
}

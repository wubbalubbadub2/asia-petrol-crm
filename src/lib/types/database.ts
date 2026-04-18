export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      alerts: {
        Row: {
          created_at: string
          id: string
          message: string
          read: boolean
          severity: string
          store_id: string
          title: string
          type: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          read?: boolean
          severity?: string
          store_id: string
          title: string
          type: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          read?: boolean
          severity?: string
          store_id?: string
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "alerts_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      application_deals: {
        Row: {
          allocated_volume: number | null
          application_id: string
          deal_id: string
          id: string
        }
        Insert: {
          allocated_volume?: number | null
          application_id: string
          deal_id: string
          id?: string
        }
        Update: {
          allocated_volume?: number | null
          application_id?: string
          deal_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_deals_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_deals_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      applications: {
        Row: {
          application_number: string | null
          assigned_by: string | null
          assigned_manager_id: string | null
          buyer_bin_for_snt: string | null
          buyer_name_for_snt: string | null
          carrier: string | null
          consignee_bin: string | null
          consignee_code_12: string | null
          consignee_code_4: string | null
          consignee_legal_address: string | null
          consignee_name: string | null
          consignee_postal_address: string | null
          consignor: string | null
          created_at: string | null
          date: string
          delivery_address_for_snt: string | null
          destination_station_id: string | null
          fuel_type_id: string | null
          id: string
          is_ordered: boolean | null
          pdf_file_path: string | null
          product_name: string | null
          siding: string | null
          source_email: string | null
          station_code: string | null
          tariff_payer: string | null
          tax_authority_code: string | null
          tonnage: number | null
          updated_at: string | null
          virtual_warehouse_id: string | null
          virtual_warehouse_name: string | null
          wagon_operator: string | null
        }
        Insert: {
          application_number?: string | null
          assigned_by?: string | null
          assigned_manager_id?: string | null
          buyer_bin_for_snt?: string | null
          buyer_name_for_snt?: string | null
          carrier?: string | null
          consignee_bin?: string | null
          consignee_code_12?: string | null
          consignee_code_4?: string | null
          consignee_legal_address?: string | null
          consignee_name?: string | null
          consignee_postal_address?: string | null
          consignor?: string | null
          created_at?: string | null
          date: string
          delivery_address_for_snt?: string | null
          destination_station_id?: string | null
          fuel_type_id?: string | null
          id?: string
          is_ordered?: boolean | null
          pdf_file_path?: string | null
          product_name?: string | null
          siding?: string | null
          source_email?: string | null
          station_code?: string | null
          tariff_payer?: string | null
          tax_authority_code?: string | null
          tonnage?: number | null
          updated_at?: string | null
          virtual_warehouse_id?: string | null
          virtual_warehouse_name?: string | null
          wagon_operator?: string | null
        }
        Update: {
          application_number?: string | null
          assigned_by?: string | null
          assigned_manager_id?: string | null
          buyer_bin_for_snt?: string | null
          buyer_name_for_snt?: string | null
          carrier?: string | null
          consignee_bin?: string | null
          consignee_code_12?: string | null
          consignee_code_4?: string | null
          consignee_legal_address?: string | null
          consignee_name?: string | null
          consignee_postal_address?: string | null
          consignor?: string | null
          created_at?: string | null
          date?: string
          delivery_address_for_snt?: string | null
          destination_station_id?: string | null
          fuel_type_id?: string | null
          id?: string
          is_ordered?: boolean | null
          pdf_file_path?: string | null
          product_name?: string | null
          siding?: string | null
          source_email?: string | null
          station_code?: string | null
          tariff_payer?: string | null
          tax_authority_code?: string | null
          tonnage?: number | null
          updated_at?: string | null
          virtual_warehouse_id?: string | null
          virtual_warehouse_name?: string | null
          wagon_operator?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "applications_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_assigned_manager_id_fkey"
            columns: ["assigned_manager_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_destination_station_id_fkey"
            columns: ["destination_station_id"]
            isOneToOne: false
            referencedRelation: "stations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_fuel_type_id_fkey"
            columns: ["fuel_type_id"]
            isOneToOne: false
            referencedRelation: "fuel_types"
            referencedColumns: ["id"]
          },
        ]
      }
      arbitrage_items: {
        Row: {
          commission_rate: number | null
          created_at: string | null
          delivery_cost_kzt: number | null
          exchange_rate: number
          id: string
          kaspi_category: string | null
          kaspi_price: number
          kaspi_product_id: string | null
          kaspi_product_name: string
          kaspi_seller_count: number | null
          kaspi_sku: string | null
          margin_pct: number | null
          net_profit_kzt: number | null
          notes: string | null
          source_article_id: string | null
          source_platform: string
          source_price_kzt: number | null
          source_price_rub: number
          status: string | null
          store_id: string
        }
        Insert: {
          commission_rate?: number | null
          created_at?: string | null
          delivery_cost_kzt?: number | null
          exchange_rate: number
          id?: string
          kaspi_category?: string | null
          kaspi_price: number
          kaspi_product_id?: string | null
          kaspi_product_name: string
          kaspi_seller_count?: number | null
          kaspi_sku?: string | null
          margin_pct?: number | null
          net_profit_kzt?: number | null
          notes?: string | null
          source_article_id?: string | null
          source_platform?: string
          source_price_kzt?: number | null
          source_price_rub: number
          status?: string | null
          store_id: string
        }
        Update: {
          commission_rate?: number | null
          created_at?: string | null
          delivery_cost_kzt?: number | null
          exchange_rate?: number
          id?: string
          kaspi_category?: string | null
          kaspi_price?: number
          kaspi_product_id?: string | null
          kaspi_product_name?: string
          kaspi_seller_count?: number | null
          kaspi_sku?: string | null
          margin_pct?: number | null
          net_profit_kzt?: number | null
          notes?: string | null
          source_article_id?: string | null
          source_platform?: string
          source_price_kzt?: number | null
          source_price_rub?: number
          status?: string | null
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "arbitrage_items_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      archive_years: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          id: string
          is_locked: boolean | null
          year: number
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          id?: string
          is_locked?: boolean | null
          year: number
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          id?: string
          is_locked?: boolean | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "archive_years_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      company_groups: {
        Row: {
          bin_iin: string | null
          created_at: string | null
          full_name: string | null
          id: string
          is_active: boolean | null
          legal_address: string | null
          name: string
          short_name: string | null
          updated_at: string | null
        }
        Insert: {
          bin_iin?: string | null
          created_at?: string | null
          full_name?: string | null
          id?: string
          is_active?: boolean | null
          legal_address?: string | null
          name: string
          short_name?: string | null
          updated_at?: string | null
        }
        Update: {
          bin_iin?: string | null
          created_at?: string | null
          full_name?: string | null
          id?: string
          is_active?: boolean | null
          legal_address?: string | null
          name?: string
          short_name?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      competitor_prices: {
        Row: {
          competitor_id: string
          has_kaspi_delivery: boolean | null
          price: number
          product_id: string
          time: string
        }
        Insert: {
          competitor_id: string
          has_kaspi_delivery?: boolean | null
          price: number
          product_id: string
          time?: string
        }
        Update: {
          competitor_id?: string
          has_kaspi_delivery?: boolean | null
          price?: number
          product_id?: string
          time?: string
        }
        Relationships: [
          {
            foreignKeyName: "competitor_prices_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: false
            referencedRelation: "competitors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competitor_prices_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      competitors: {
        Row: {
          created_at: string
          id: string
          kaspi_merchant_name: string
          price_index: number | null
          rating: number | null
          shared_product_count: number | null
          store_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          kaspi_merchant_name: string
          price_index?: number | null
          rating?: number | null
          shared_product_count?: number | null
          store_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          kaspi_merchant_name?: string
          price_index?: number | null
          rating?: number | null
          shared_product_count?: number | null
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "competitors_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      counterparties: {
        Row: {
          bin_iin: string | null
          created_at: string | null
          full_name: string
          id: string
          is_active: boolean | null
          legal_address: string | null
          short_name: string | null
          type: string
          updated_at: string | null
        }
        Insert: {
          bin_iin?: string | null
          created_at?: string | null
          full_name: string
          id?: string
          is_active?: boolean | null
          legal_address?: string | null
          short_name?: string | null
          type: string
          updated_at?: string | null
        }
        Update: {
          bin_iin?: string | null
          created_at?: string | null
          full_name?: string
          id?: string
          is_active?: boolean | null
          legal_address?: string | null
          short_name?: string | null
          type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      deal_activity: {
        Row: {
          application_id: string | null
          content: string
          created_at: string | null
          deal_id: string | null
          id: string
          metadata: Json | null
          type: string
          user_id: string | null
        }
        Insert: {
          application_id?: string | null
          content: string
          created_at?: string | null
          deal_id?: string | null
          id?: string
          metadata?: Json | null
          type?: string
          user_id?: string | null
        }
        Update: {
          application_id?: string | null
          content?: string
          created_at?: string | null
          deal_id?: string | null
          id?: string
          metadata?: Json | null
          type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deal_activity_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_activity_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_activity_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_attachments: {
        Row: {
          category: string
          deal_id: string
          file_name: string
          file_path: string
          file_size: number | null
          id: string
          mime_type: string | null
          uploaded_at: string | null
          uploaded_by: string | null
        }
        Insert: {
          category: string
          deal_id: string
          file_name: string
          file_path: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          uploaded_at?: string | null
          uploaded_by?: string | null
        }
        Update: {
          category?: string
          deal_id?: string
          file_name?: string
          file_path?: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          uploaded_at?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deal_attachments_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_company_groups: {
        Row: {
          company_group_id: string
          contract_ref: string | null
          deal_id: string
          id: string
          position: number
          price: number | null
        }
        Insert: {
          company_group_id: string
          contract_ref?: string | null
          deal_id: string
          id?: string
          position: number
          price?: number | null
        }
        Update: {
          company_group_id?: string
          contract_ref?: string | null
          deal_id?: string
          id?: string
          position?: number
          price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "deal_company_groups_company_group_id_fkey"
            columns: ["company_group_id"]
            isOneToOne: false
            referencedRelation: "company_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_company_groups_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_payments: {
        Row: {
          amount: number
          created_at: string | null
          created_by: string | null
          currency: string | null
          deal_id: string
          description: string | null
          id: string
          payment_date: string
          side: string
        }
        Insert: {
          amount: number
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          deal_id: string
          description?: string | null
          id?: string
          payment_date: string
          side: string
        }
        Update: {
          amount?: number
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          deal_id?: string
          description?: string | null
          id?: string
          payment_date?: string
          side?: string
        }
        Relationships: [
          {
            foreignKeyName: "deal_payments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_payments_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_sequences: {
        Row: {
          deal_type: Database["public"]["Enums"]["deal_type"]
          id: string
          last_number: number
          year: number
        }
        Insert: {
          deal_type: Database["public"]["Enums"]["deal_type"]
          id?: string
          last_number?: number
          year: number
        }
        Update: {
          deal_type?: Database["public"]["Enums"]["deal_type"]
          id?: string
          last_number?: number
          year?: number
        }
        Relationships: []
      }
      deal_shipment_prices: {
        Row: {
          amount: number | null
          border_crossing_date: string | null
          calculated_price: number | null
          created_at: string | null
          created_by: string | null
          deal_id: string
          discount: number | null
          id: string
          notes: string | null
          quotation_avg: number | null
          quotation_product_type_id: string | null
          shipment_date: string | null
          side: string
          trigger_basis: Database["public"]["Enums"]["trigger_basis"]
          trigger_days: number
          trigger_start_date: string | null
          updated_at: string | null
          volume: number | null
        }
        Insert: {
          amount?: number | null
          border_crossing_date?: string | null
          calculated_price?: number | null
          created_at?: string | null
          created_by?: string | null
          deal_id: string
          discount?: number | null
          id?: string
          notes?: string | null
          quotation_avg?: number | null
          quotation_product_type_id?: string | null
          shipment_date?: string | null
          side: string
          trigger_basis?: Database["public"]["Enums"]["trigger_basis"]
          trigger_days?: number
          trigger_start_date?: string | null
          updated_at?: string | null
          volume?: number | null
        }
        Update: {
          amount?: number | null
          border_crossing_date?: string | null
          calculated_price?: number | null
          created_at?: string | null
          created_by?: string | null
          deal_id?: string
          discount?: number | null
          id?: string
          notes?: string | null
          quotation_avg?: number | null
          quotation_product_type_id?: string | null
          shipment_date?: string | null
          side?: string
          trigger_basis?: Database["public"]["Enums"]["trigger_basis"]
          trigger_days?: number
          trigger_start_date?: string | null
          updated_at?: string | null
          volume?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "deal_shipment_prices_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_shipment_prices_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_shipment_prices_quotation_product_type_id_fkey"
            columns: ["quotation_product_type_id"]
            isOneToOne: false
            referencedRelation: "quotation_product_types"
            referencedColumns: ["id"]
          },
        ]
      }
      deals: {
        Row: {
          actual_shipped_volume: number | null
          actual_tariff: number | null
          archived_at: string | null
          buyer_contract: string | null
          buyer_contracted_amount: number | null
          buyer_contracted_volume: number | null
          buyer_debt: number | null
          buyer_delivery_basis: string | null
          buyer_destination_station_id: string | null
          buyer_discount: number | null
          buyer_id: string | null
          buyer_manager_id: string | null
          buyer_multi_deal_payments: string | null
          buyer_ordered_volume: number | null
          buyer_payment: number | null
          buyer_payment_date: string | null
          buyer_price: number | null
          buyer_price_condition:
            | Database["public"]["Enums"]["price_condition"]
            | null
          buyer_quotation: number | null
          buyer_quotation_comment: string | null
          buyer_remaining: number | null
          buyer_ship_date: string | null
          buyer_shipped_amount: number | null
          buyer_shipped_volume: number | null
          buyer_snt_written: string | null
          created_at: string | null
          created_by: string | null
          currency: string | null
          deal_code: string | null
          deal_number: number
          deal_type: Database["public"]["Enums"]["deal_type"]
          factory_id: string | null
          forwarder_id: string | null
          fuel_type_id: string | null
          id: string
          invoice_amount: number | null
          invoice_volume: number | null
          is_archived: boolean | null
          is_draft: boolean | null
          logistics_company_group_id: string | null
          logistics_notes: string | null
          month: string
          planned_tariff: number | null
          preliminary_amount: number | null
          preliminary_tonnage: number | null
          quarter: string | null
          railway_in_price: boolean | null
          sulfur_percent: string | null
          supplier_balance: number | null
          supplier_contract: string | null
          supplier_contracted_amount: number | null
          supplier_contracted_volume: number | null
          supplier_delivery_basis: string | null
          supplier_discount: number | null
          supplier_id: string | null
          supplier_manager_id: string | null
          supplier_payment: number | null
          supplier_payment_date: string | null
          supplier_price: number | null
          supplier_price_condition:
            | Database["public"]["Enums"]["price_condition"]
            | null
          supplier_quotation: number | null
          supplier_quotation_comment: string | null
          supplier_shipped_amount: number | null
          surcharge_amount: number | null
          surcharge_reinvoiced_to: string | null
          trader_id: string | null
          trigger_basis: Database["public"]["Enums"]["trigger_basis"] | null
          updated_at: string | null
          year: number
        }
        Insert: {
          actual_shipped_volume?: number | null
          actual_tariff?: number | null
          archived_at?: string | null
          buyer_contract?: string | null
          buyer_contracted_amount?: number | null
          buyer_contracted_volume?: number | null
          buyer_debt?: number | null
          buyer_delivery_basis?: string | null
          buyer_destination_station_id?: string | null
          buyer_discount?: number | null
          buyer_id?: string | null
          buyer_manager_id?: string | null
          buyer_multi_deal_payments?: string | null
          buyer_ordered_volume?: number | null
          buyer_payment?: number | null
          buyer_payment_date?: string | null
          buyer_price?: number | null
          buyer_price_condition?:
            | Database["public"]["Enums"]["price_condition"]
            | null
          buyer_quotation?: number | null
          buyer_quotation_comment?: string | null
          buyer_remaining?: number | null
          buyer_ship_date?: string | null
          buyer_shipped_amount?: number | null
          buyer_shipped_volume?: number | null
          buyer_snt_written?: string | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          deal_code?: string | null
          deal_number: number
          deal_type: Database["public"]["Enums"]["deal_type"]
          factory_id?: string | null
          forwarder_id?: string | null
          fuel_type_id?: string | null
          id?: string
          invoice_amount?: number | null
          invoice_volume?: number | null
          is_archived?: boolean | null
          is_draft?: boolean | null
          logistics_company_group_id?: string | null
          logistics_notes?: string | null
          month: string
          planned_tariff?: number | null
          preliminary_amount?: number | null
          preliminary_tonnage?: number | null
          quarter?: string | null
          railway_in_price?: boolean | null
          sulfur_percent?: string | null
          supplier_balance?: number | null
          supplier_contract?: string | null
          supplier_contracted_amount?: number | null
          supplier_contracted_volume?: number | null
          supplier_delivery_basis?: string | null
          supplier_discount?: number | null
          supplier_id?: string | null
          supplier_manager_id?: string | null
          supplier_payment?: number | null
          supplier_payment_date?: string | null
          supplier_price?: number | null
          supplier_price_condition?:
            | Database["public"]["Enums"]["price_condition"]
            | null
          supplier_quotation?: number | null
          supplier_quotation_comment?: string | null
          supplier_shipped_amount?: number | null
          surcharge_amount?: number | null
          surcharge_reinvoiced_to?: string | null
          trader_id?: string | null
          trigger_basis?: Database["public"]["Enums"]["trigger_basis"] | null
          updated_at?: string | null
          year: number
        }
        Update: {
          actual_shipped_volume?: number | null
          actual_tariff?: number | null
          archived_at?: string | null
          buyer_contract?: string | null
          buyer_contracted_amount?: number | null
          buyer_contracted_volume?: number | null
          buyer_debt?: number | null
          buyer_delivery_basis?: string | null
          buyer_destination_station_id?: string | null
          buyer_discount?: number | null
          buyer_id?: string | null
          buyer_manager_id?: string | null
          buyer_multi_deal_payments?: string | null
          buyer_ordered_volume?: number | null
          buyer_payment?: number | null
          buyer_payment_date?: string | null
          buyer_price?: number | null
          buyer_price_condition?:
            | Database["public"]["Enums"]["price_condition"]
            | null
          buyer_quotation?: number | null
          buyer_quotation_comment?: string | null
          buyer_remaining?: number | null
          buyer_ship_date?: string | null
          buyer_shipped_amount?: number | null
          buyer_shipped_volume?: number | null
          buyer_snt_written?: string | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          deal_code?: string | null
          deal_number?: number
          deal_type?: Database["public"]["Enums"]["deal_type"]
          factory_id?: string | null
          forwarder_id?: string | null
          fuel_type_id?: string | null
          id?: string
          invoice_amount?: number | null
          invoice_volume?: number | null
          is_archived?: boolean | null
          is_draft?: boolean | null
          logistics_company_group_id?: string | null
          logistics_notes?: string | null
          month?: string
          planned_tariff?: number | null
          preliminary_amount?: number | null
          preliminary_tonnage?: number | null
          quarter?: string | null
          railway_in_price?: boolean | null
          sulfur_percent?: string | null
          supplier_balance?: number | null
          supplier_contract?: string | null
          supplier_contracted_amount?: number | null
          supplier_contracted_volume?: number | null
          supplier_delivery_basis?: string | null
          supplier_discount?: number | null
          supplier_id?: string | null
          supplier_manager_id?: string | null
          supplier_payment?: number | null
          supplier_payment_date?: string | null
          supplier_price?: number | null
          supplier_price_condition?:
            | Database["public"]["Enums"]["price_condition"]
            | null
          supplier_quotation?: number | null
          supplier_quotation_comment?: string | null
          supplier_shipped_amount?: number | null
          surcharge_amount?: number | null
          surcharge_reinvoiced_to?: string | null
          trader_id?: string | null
          trigger_basis?: Database["public"]["Enums"]["trigger_basis"] | null
          updated_at?: string | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "deals_buyer_destination_station_id_fkey"
            columns: ["buyer_destination_station_id"]
            isOneToOne: false
            referencedRelation: "stations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "counterparties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_buyer_manager_id_fkey"
            columns: ["buyer_manager_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_forwarder_id_fkey"
            columns: ["forwarder_id"]
            isOneToOne: false
            referencedRelation: "forwarders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_fuel_type_id_fkey"
            columns: ["fuel_type_id"]
            isOneToOne: false
            referencedRelation: "fuel_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_logistics_company_group_id_fkey"
            columns: ["logistics_company_group_id"]
            isOneToOne: false
            referencedRelation: "company_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "counterparties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_supplier_manager_id_fkey"
            columns: ["supplier_manager_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_trader_id_fkey"
            columns: ["trader_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      dt_kt_logistics: {
        Row: {
          company_group_id: string
          created_at: string | null
          fines: number | null
          forwarder_id: string
          id: string
          ogem: number | null
          opening_balance: number | null
          payment: number | null
          refund: number | null
          surcharge_preliminary: number | null
          updated_at: string | null
          year: number
        }
        Insert: {
          company_group_id: string
          created_at?: string | null
          fines?: number | null
          forwarder_id: string
          id?: string
          ogem?: number | null
          opening_balance?: number | null
          payment?: number | null
          refund?: number | null
          surcharge_preliminary?: number | null
          updated_at?: string | null
          year: number
        }
        Update: {
          company_group_id?: string
          created_at?: string | null
          fines?: number | null
          forwarder_id?: string
          id?: string
          ogem?: number | null
          opening_balance?: number | null
          payment?: number | null
          refund?: number | null
          surcharge_preliminary?: number | null
          updated_at?: string | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "dt_kt_logistics_company_group_id_fkey"
            columns: ["company_group_id"]
            isOneToOne: false
            referencedRelation: "company_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dt_kt_logistics_forwarder_id_fkey"
            columns: ["forwarder_id"]
            isOneToOne: false
            referencedRelation: "forwarders"
            referencedColumns: ["id"]
          },
        ]
      }
      dt_kt_payments: {
        Row: {
          amount: number
          company_group_id: string
          created_at: string | null
          created_by: string | null
          currency: string | null
          description: string | null
          dt_kt_id: string | null
          forwarder_id: string
          id: string
          payment_date: string
        }
        Insert: {
          amount: number
          company_group_id: string
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          description?: string | null
          dt_kt_id?: string | null
          forwarder_id: string
          id?: string
          payment_date: string
        }
        Update: {
          amount?: number
          company_group_id?: string
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          description?: string | null
          dt_kt_id?: string | null
          forwarder_id?: string
          id?: string
          payment_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "dt_kt_payments_company_group_id_fkey"
            columns: ["company_group_id"]
            isOneToOne: false
            referencedRelation: "company_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dt_kt_payments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dt_kt_payments_dt_kt_id_fkey"
            columns: ["dt_kt_id"]
            isOneToOne: false
            referencedRelation: "dt_kt_logistics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dt_kt_payments_forwarder_id_fkey"
            columns: ["forwarder_id"]
            isOneToOne: false
            referencedRelation: "forwarders"
            referencedColumns: ["id"]
          },
        ]
      }
      esf_documents: {
        Row: {
          account_system_number: string | null
          deal_id: string | null
          goods_description: string | null
          id: string
          imported_at: string | null
          imported_by: string | null
          issue_date: string | null
          price_per_unit: number | null
          quantity: number | null
          raw_data: Json | null
          receiver_bin: string | null
          receiver_name: string | null
          registration_number: string | null
          source_file_path: string | null
          supplier_address: string | null
          supplier_bin: string | null
          supplier_name: string | null
          tax_amount: number | null
          total_with_tax: number | null
          total_without_tax: number | null
          turnover_date: string | null
        }
        Insert: {
          account_system_number?: string | null
          deal_id?: string | null
          goods_description?: string | null
          id?: string
          imported_at?: string | null
          imported_by?: string | null
          issue_date?: string | null
          price_per_unit?: number | null
          quantity?: number | null
          raw_data?: Json | null
          receiver_bin?: string | null
          receiver_name?: string | null
          registration_number?: string | null
          source_file_path?: string | null
          supplier_address?: string | null
          supplier_bin?: string | null
          supplier_name?: string | null
          tax_amount?: number | null
          total_with_tax?: number | null
          total_without_tax?: number | null
          turnover_date?: string | null
        }
        Update: {
          account_system_number?: string | null
          deal_id?: string | null
          goods_description?: string | null
          id?: string
          imported_at?: string | null
          imported_by?: string | null
          issue_date?: string | null
          price_per_unit?: number | null
          quantity?: number | null
          raw_data?: Json | null
          receiver_bin?: string | null
          receiver_name?: string | null
          registration_number?: string | null
          source_file_path?: string | null
          supplier_address?: string | null
          supplier_bin?: string | null
          supplier_name?: string | null
          tax_amount?: number | null
          total_with_tax?: number | null
          total_without_tax?: number | null
          turnover_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "esf_documents_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esf_documents_imported_by_fkey"
            columns: ["imported_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      factories: {
        Row: {
          code: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
          updated_at: string | null
        }
        Insert: {
          code?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          updated_at?: string | null
        }
        Update: {
          code?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      forwarders: {
        Row: {
          bin_iin: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
          updated_at: string | null
        }
        Insert: {
          bin_iin?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          updated_at?: string | null
        }
        Update: {
          bin_iin?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      fuel_types: {
        Row: {
          color: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
          sort_order: number | null
          sulfur_percent: string | null
          updated_at: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          sort_order?: number | null
          sulfur_percent?: string | null
          updated_at?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          sort_order?: number | null
          sulfur_percent?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      niche_snapshots: {
        Row: {
          category_id: string
          category_label: string
          created_at: string
          id: string
          keyword: string
          metrics: Json
          reasons: Json
          recommendations: Json
          score: number
          scraped_at: string
          subscores: Json
          updated_at: string
          verdict: string
          verdict_key: string
        }
        Insert: {
          category_id: string
          category_label: string
          created_at?: string
          id?: string
          keyword: string
          metrics?: Json
          reasons?: Json
          recommendations?: Json
          score?: number
          scraped_at?: string
          subscores?: Json
          updated_at?: string
          verdict?: string
          verdict_key?: string
        }
        Update: {
          category_id?: string
          category_label?: string
          created_at?: string
          id?: string
          keyword?: string
          metrics?: Json
          reasons?: Json
          recommendations?: Json
          score?: number
          scraped_at?: string
          subscores?: Json
          updated_at?: string
          verdict?: string
          verdict_key?: string
        }
        Relationships: []
      }
      niches: {
        Row: {
          avg_price: number | null
          category: string
          competition: string
          created_at: string
          demand_trend: Json | null
          growth: number | null
          id: string
          name: string
          seller_count: number | null
          top_product: string | null
          updated_at: string
        }
        Insert: {
          avg_price?: number | null
          category: string
          competition?: string
          created_at?: string
          demand_trend?: Json | null
          growth?: number | null
          id?: string
          name: string
          seller_count?: number | null
          top_product?: string | null
          updated_at?: string
        }
        Update: {
          avg_price?: number | null
          category?: string
          competition?: string
          created_at?: string
          demand_trend?: Json | null
          growth?: number | null
          id?: string
          name?: string
          seller_count?: number | null
          top_product?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      order_entries: {
        Row: {
          base_price: number
          category_code: string | null
          category_title: string | null
          delivery_cost: number | null
          entry_number: number
          id: string
          kaspi_entry_id: string
          order_id: string
          product_code: string | null
          product_manufacturer: string | null
          product_name: string | null
          quantity: number
          store_id: string
          total_price: number
          warehouse_address: string | null
          warehouse_name: string | null
        }
        Insert: {
          base_price?: number
          category_code?: string | null
          category_title?: string | null
          delivery_cost?: number | null
          entry_number?: number
          id?: string
          kaspi_entry_id: string
          order_id: string
          product_code?: string | null
          product_manufacturer?: string | null
          product_name?: string | null
          quantity?: number
          store_id: string
          total_price?: number
          warehouse_address?: string | null
          warehouse_name?: string | null
        }
        Update: {
          base_price?: number
          category_code?: string | null
          category_title?: string | null
          delivery_cost?: number | null
          entry_number?: number
          id?: string
          kaspi_entry_id?: string
          order_id?: string
          product_code?: string | null
          product_manufacturer?: string | null
          product_name?: string | null
          quantity?: number
          store_id?: string
          total_price?: number
          warehouse_address?: string | null
          warehouse_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_entries_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_entries_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          approved_by_bank_date: string | null
          cancellation_reason: string | null
          code: string
          creation_date: string
          credit_term: number | null
          customer_kaspi_id: string | null
          customer_name: string | null
          customer_phone: string | null
          delivery_address_formatted: string | null
          delivery_address_town: string | null
          delivery_cost: number | null
          delivery_cost_for_seller: number | null
          delivery_latitude: number | null
          delivery_longitude: number | null
          delivery_mode: string
          express: boolean | null
          id: string
          is_kaspi_delivery: boolean | null
          kaspi_order_id: string
          number_of_space: number | null
          payment_mode: string
          planned_delivery_date: string | null
          pre_order: boolean | null
          signature_required: boolean | null
          state: string
          status: string
          store_id: string
          synced_at: string
          total_price: number
          waybill: string | null
        }
        Insert: {
          approved_by_bank_date?: string | null
          cancellation_reason?: string | null
          code: string
          creation_date: string
          credit_term?: number | null
          customer_kaspi_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          delivery_address_formatted?: string | null
          delivery_address_town?: string | null
          delivery_cost?: number | null
          delivery_cost_for_seller?: number | null
          delivery_latitude?: number | null
          delivery_longitude?: number | null
          delivery_mode: string
          express?: boolean | null
          id?: string
          is_kaspi_delivery?: boolean | null
          kaspi_order_id: string
          number_of_space?: number | null
          payment_mode: string
          planned_delivery_date?: string | null
          pre_order?: boolean | null
          signature_required?: boolean | null
          state: string
          status: string
          store_id: string
          synced_at?: string
          total_price?: number
          waybill?: string | null
        }
        Update: {
          approved_by_bank_date?: string | null
          cancellation_reason?: string | null
          code?: string
          creation_date?: string
          credit_term?: number | null
          customer_kaspi_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          delivery_address_formatted?: string | null
          delivery_address_town?: string | null
          delivery_cost?: number | null
          delivery_cost_for_seller?: number | null
          delivery_latitude?: number | null
          delivery_longitude?: number | null
          delivery_mode?: string
          express?: boolean | null
          id?: string
          is_kaspi_delivery?: boolean | null
          kaspi_order_id?: string
          number_of_space?: number | null
          payment_mode?: string
          planned_delivery_date?: string | null
          pre_order?: boolean | null
          signature_required?: boolean | null
          state?: string
          status?: string
          store_id?: string
          synced_at?: string
          total_price?: number
          waybill?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_runs: {
        Row: {
          budget: number
          completed_at: string | null
          created_at: string | null
          error: string | null
          excluded_categories: string[] | null
          id: string
          result: Json | null
          status: string
          user_id: string
        }
        Insert: {
          budget: number
          completed_at?: string | null
          created_at?: string | null
          error?: string | null
          excluded_categories?: string[] | null
          id?: string
          result?: Json | null
          status?: string
          user_id: string
        }
        Update: {
          budget?: number
          completed_at?: string | null
          created_at?: string | null
          error?: string | null
          excluded_categories?: string[] | null
          id?: string
          result?: Json | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_runs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_usage: {
        Row: {
          chat_messages: number | null
          run_count: number | null
          run_date: string
          user_id: string
        }
        Insert: {
          chat_messages?: number | null
          run_count?: number | null
          run_date?: string
          user_id: string
        }
        Update: {
          chat_messages?: number | null
          run_count?: number | null
          run_date?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_usage_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      price_changes: {
        Row: {
          applied: boolean
          created_at: string
          id: string
          new_price: number
          old_price: number
          product_id: string
          source: string
          store_id: string
        }
        Insert: {
          applied?: boolean
          created_at?: string
          id?: string
          new_price: number
          old_price: number
          product_id: string
          source?: string
          store_id: string
        }
        Update: {
          applied?: boolean
          created_at?: string
          id?: string
          new_price?: number
          old_price?: number
          product_id?: string
          source?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_changes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_changes_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      price_history: {
        Row: {
          avg_competitor_price: number | null
          competitor_count: number | null
          max_competitor_price: number | null
          min_competitor_price: number | null
          our_price: number
          product_id: string
          store_id: string
          time: string
        }
        Insert: {
          avg_competitor_price?: number | null
          competitor_count?: number | null
          max_competitor_price?: number | null
          min_competitor_price?: number | null
          our_price: number
          product_id: string
          store_id: string
          time?: string
        }
        Update: {
          avg_competitor_price?: number | null
          competitor_count?: number | null
          max_competitor_price?: number | null
          min_competitor_price?: number | null
          our_price?: number
          product_id?: string
          store_id?: string
          time?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_history_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_history_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      price_list_items: {
        Row: {
          created_at: string | null
          id: string
          included: boolean | null
          is_pre_order: boolean | null
          kaspi_sku: string
          name: string
          pre_order_days: number | null
          price: number
          price_list_id: string
          product_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          included?: boolean | null
          is_pre_order?: boolean | null
          kaspi_sku: string
          name: string
          pre_order_days?: number | null
          price: number
          price_list_id: string
          product_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          included?: boolean | null
          is_pre_order?: boolean | null
          kaspi_sku?: string
          name?: string
          pre_order_days?: number | null
          price?: number
          price_list_id?: string
          product_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "price_list_items_price_list_id_fkey"
            columns: ["price_list_id"]
            isOneToOne: false
            referencedRelation: "price_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_list_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      price_lists: {
        Row: {
          created_at: string | null
          feed_token: string | null
          id: string
          last_exported_at: string | null
          name: string
          store_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          feed_token?: string | null
          id?: string
          last_exported_at?: string | null
          name?: string
          store_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          feed_token?: string | null
          id?: string
          last_exported_at?: string | null
          name?: string
          store_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "price_lists_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      product_catalog: {
        Row: {
          brand: string | null
          category_codes: string[] | null
          created_at: string | null
          embedding: string | null
          image_url: string
          kaspi_id: string
          price: number | null
          rating: number | null
          review_count: number | null
          title: string
        }
        Insert: {
          brand?: string | null
          category_codes?: string[] | null
          created_at?: string | null
          embedding?: string | null
          image_url?: string
          kaspi_id: string
          price?: number | null
          rating?: number | null
          review_count?: number | null
          title?: string
        }
        Update: {
          brand?: string | null
          category_codes?: string[] | null
          created_at?: string | null
          embedding?: string | null
          image_url?: string
          kaspi_id?: string
          price?: number | null
          rating?: number | null
          review_count?: number | null
          title?: string
        }
        Relationships: []
      }
      product_image_index: {
        Row: {
          brand: string | null
          category_codes: string[] | null
          category_id: number | null
          id: string
          image_embedding: string | null
          image_phash: unknown
          image_url: string
          indexed_at: string | null
          kaspi_product_id: string
          price: number | null
          product_title: string
          product_url: string
          rating: number | null
          review_count: number | null
        }
        Insert: {
          brand?: string | null
          category_codes?: string[] | null
          category_id?: number | null
          id?: string
          image_embedding?: string | null
          image_phash?: unknown
          image_url: string
          indexed_at?: string | null
          kaspi_product_id: string
          price?: number | null
          product_title: string
          product_url: string
          rating?: number | null
          review_count?: number | null
        }
        Update: {
          brand?: string | null
          category_codes?: string[] | null
          category_id?: number | null
          id?: string
          image_embedding?: string | null
          image_phash?: unknown
          image_url?: string
          indexed_at?: string | null
          kaspi_product_id?: string
          price?: number | null
          product_title?: string
          product_url?: string
          rating?: number | null
          review_count?: number | null
        }
        Relationships: []
      }
      product_repricing_rules: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          product_id: string
          store_id: string
          strategy: string
          updated_at: string
          value: number | null
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          product_id: string
          store_id: string
          strategy?: string
          updated_at?: string
          value?: number | null
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          product_id?: string
          store_id?: string
          strategy?: string
          updated_at?: string
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_repricing_rules_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_repricing_rules_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      product_sales: {
        Row: {
          orders: number | null
          product_id: string
          returns: number | null
          revenue: number | null
          store_id: string
          time: string
        }
        Insert: {
          orders?: number | null
          product_id: string
          returns?: number | null
          revenue?: number | null
          store_id: string
          time?: string
        }
        Update: {
          orders?: number | null
          product_id?: string
          returns?: number | null
          revenue?: number | null
          store_id?: string
          time?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_sales_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_sales_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          category: string | null
          commission_rate: number | null
          cost_price: number | null
          created_at: string
          current_price: number
          id: string
          image_url: string | null
          kaspi_sku: string | null
          margin_percent: number | null
          name: string
          orders: number | null
          rating: number | null
          returns: number | null
          revenue: number | null
          review_count: number | null
          status: string
          stock_quantity: number | null
          store_id: string
          trend: number | null
          updated_at: string
        }
        Insert: {
          category?: string | null
          commission_rate?: number | null
          cost_price?: number | null
          created_at?: string
          current_price?: number
          id?: string
          image_url?: string | null
          kaspi_sku?: string | null
          margin_percent?: number | null
          name: string
          orders?: number | null
          rating?: number | null
          returns?: number | null
          revenue?: number | null
          review_count?: number | null
          status?: string
          stock_quantity?: number | null
          store_id: string
          trend?: number | null
          updated_at?: string
        }
        Update: {
          category?: string | null
          commission_rate?: number | null
          cost_price?: number | null
          created_at?: string
          current_price?: number
          id?: string
          image_url?: string | null
          kaspi_sku?: string | null
          margin_percent?: number | null
          name?: string
          orders?: number | null
          rating?: number | null
          returns?: number | null
          revenue?: number | null
          review_count?: number | null
          status?: string
          stock_quantity?: number | null
          store_id?: string
          trend?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string | null
          full_name: string
          id: string
          is_active: boolean | null
          region_id: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          full_name: string
          id: string
          is_active?: boolean | null
          region_id?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          full_name?: string
          id?: string
          is_active?: boolean | null
          region_id?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
        ]
      }
      promotions: {
        Row: {
          budget: number | null
          clicks: number | null
          conversions: number | null
          created_at: string
          end_date: string
          id: string
          impressions: number | null
          name: string
          products_count: number | null
          roi: number | null
          spent: number | null
          start_date: string
          status: string
          store_id: string
          type: string
          updated_at: string
        }
        Insert: {
          budget?: number | null
          clicks?: number | null
          conversions?: number | null
          created_at?: string
          end_date: string
          id?: string
          impressions?: number | null
          name: string
          products_count?: number | null
          roi?: number | null
          spent?: number | null
          start_date: string
          status?: string
          store_id: string
          type: string
          updated_at?: string
        }
        Update: {
          budget?: number | null
          clicks?: number | null
          conversions?: number | null
          created_at?: string
          end_date?: string
          id?: string
          impressions?: number | null
          name?: string
          products_count?: number | null
          roi?: number | null
          spent?: number | null
          start_date?: string
          status?: string
          store_id?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "promotions_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      quotation_monthly_averages: {
        Row: {
          avg_cif_nwe: number | null
          avg_combined: number | null
          avg_fob_med: number | null
          avg_fob_rotterdam: number | null
          avg_price: number | null
          id: string
          month: number
          product_type_id: string
          updated_at: string | null
          year: number
        }
        Insert: {
          avg_cif_nwe?: number | null
          avg_combined?: number | null
          avg_fob_med?: number | null
          avg_fob_rotterdam?: number | null
          avg_price?: number | null
          id?: string
          month: number
          product_type_id: string
          updated_at?: string | null
          year: number
        }
        Update: {
          avg_cif_nwe?: number | null
          avg_combined?: number | null
          avg_fob_med?: number | null
          avg_fob_rotterdam?: number | null
          avg_price?: number | null
          id?: string
          month?: number
          product_type_id?: string
          updated_at?: string | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "quotation_monthly_averages_product_type_id_fkey"
            columns: ["product_type_id"]
            isOneToOne: false
            referencedRelation: "quotation_product_types"
            referencedColumns: ["id"]
          },
        ]
      }
      quotation_product_types: {
        Row: {
          basis: string | null
          created_at: string | null
          fuel_type_id: string | null
          id: string
          is_active: boolean | null
          name: string
          sort_order: number | null
          sub_name: string | null
          updated_at: string | null
        }
        Insert: {
          basis?: string | null
          created_at?: string | null
          fuel_type_id?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          sort_order?: number | null
          sub_name?: string | null
          updated_at?: string | null
        }
        Update: {
          basis?: string | null
          created_at?: string | null
          fuel_type_id?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          sort_order?: number | null
          sub_name?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quotation_product_types_fuel_type_id_fkey"
            columns: ["fuel_type_id"]
            isOneToOne: false
            referencedRelation: "fuel_types"
            referencedColumns: ["id"]
          },
        ]
      }
      quotations: {
        Row: {
          comment: string | null
          created_at: string | null
          created_by: string | null
          date: string
          id: string
          price: number | null
          price_cif_nwe: number | null
          price_cif_nwe_standalone: number | null
          price_fob_med: number | null
          price_fob_rotterdam: number | null
          product_type_id: string
          updated_at: string | null
        }
        Insert: {
          comment?: string | null
          created_at?: string | null
          created_by?: string | null
          date: string
          id?: string
          price?: number | null
          price_cif_nwe?: number | null
          price_cif_nwe_standalone?: number | null
          price_fob_med?: number | null
          price_fob_rotterdam?: number | null
          product_type_id: string
          updated_at?: string | null
        }
        Update: {
          comment?: string | null
          created_at?: string | null
          created_by?: string | null
          date?: string
          id?: string
          price?: number | null
          price_cif_nwe?: number | null
          price_cif_nwe_standalone?: number | null
          price_fob_med?: number | null
          price_fob_rotterdam?: number | null
          product_type_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quotations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotations_product_type_id_fkey"
            columns: ["product_type_id"]
            isOneToOne: false
            referencedRelation: "quotation_product_types"
            referencedColumns: ["id"]
          },
        ]
      }
      regions: {
        Row: {
          created_at: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      repricing_rules: {
        Row: {
          alert_on_undercut: boolean
          auto_apply: boolean
          auto_apply_actions: string[]
          created_at: string
          id: string
          last_auto_run: string | null
          max_undercut_pct: number
          min_margin_pct: number
          store_id: string
          updated_at: string
        }
        Insert: {
          alert_on_undercut?: boolean
          auto_apply?: boolean
          auto_apply_actions?: string[]
          created_at?: string
          id?: string
          last_auto_run?: string | null
          max_undercut_pct?: number
          min_margin_pct?: number
          store_id: string
          updated_at?: string
        }
        Update: {
          alert_on_undercut?: boolean
          auto_apply?: boolean
          auto_apply_actions?: string[]
          created_at?: string
          id?: string
          last_auto_run?: string | null
          max_undercut_pct?: number
          min_margin_pct?: number
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "repricing_rules_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: true
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      review_analytics_cache: {
        Row: {
          analytics: Json
          computed_at: string
          days: number
          id: string
          reviews_synced_at: string | null
          store_id: string
        }
        Insert: {
          analytics?: Json
          computed_at?: string
          days?: number
          id?: string
          reviews_synced_at?: string | null
          store_id: string
        }
        Update: {
          analytics?: Json
          computed_at?: string
          days?: number
          id?: string
          reviews_synced_at?: string | null
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_analytics_cache_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          approved_date: string
          comment: string | null
          id: string
          kaspi_review_id: string
          order_number: string | null
          rating: number
          store_id: string
          synced_at: string
          user_name: string | null
        }
        Insert: {
          approved_date: string
          comment?: string | null
          id?: string
          kaspi_review_id: string
          order_number?: string | null
          rating: number
          store_id: string
          synced_at?: string
          user_name?: string | null
        }
        Update: {
          approved_date?: string
          comment?: string | null
          id?: string
          kaspi_review_id?: string
          order_number?: string | null
          rating?: number
          store_id?: string
          synced_at?: string
          user_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reviews_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_registry: {
        Row: {
          additional_month: string | null
          buyer_id: string | null
          comment: string | null
          company_group_id: string | null
          created_at: string | null
          created_by: string | null
          currency: string | null
          date: string | null
          deal_id: string | null
          departure_station_id: string | null
          destination_station_id: string | null
          factory_id: string | null
          forwarder_id: string | null
          fuel_type_id: string | null
          id: string
          invoice_number: string | null
          loading_volume: number | null
          month: string | null
          quarter: string | null
          railway_tariff: number | null
          registry_type: Database["public"]["Enums"]["deal_type"]
          rounded_tonnage_from_forwarder: number | null
          row_number: number | null
          shipment_month: string | null
          shipment_volume: number | null
          shipped_tonnage_amount: number | null
          supplier_id: string | null
          updated_at: string | null
          wagon_number: string | null
          waybill_number: string | null
        }
        Insert: {
          additional_month?: string | null
          buyer_id?: string | null
          comment?: string | null
          company_group_id?: string | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          date?: string | null
          deal_id?: string | null
          departure_station_id?: string | null
          destination_station_id?: string | null
          factory_id?: string | null
          forwarder_id?: string | null
          fuel_type_id?: string | null
          id?: string
          invoice_number?: string | null
          loading_volume?: number | null
          month?: string | null
          quarter?: string | null
          railway_tariff?: number | null
          registry_type: Database["public"]["Enums"]["deal_type"]
          rounded_tonnage_from_forwarder?: number | null
          row_number?: number | null
          shipment_month?: string | null
          shipment_volume?: number | null
          shipped_tonnage_amount?: number | null
          supplier_id?: string | null
          updated_at?: string | null
          wagon_number?: string | null
          waybill_number?: string | null
        }
        Update: {
          additional_month?: string | null
          buyer_id?: string | null
          comment?: string | null
          company_group_id?: string | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          date?: string | null
          deal_id?: string | null
          departure_station_id?: string | null
          destination_station_id?: string | null
          factory_id?: string | null
          forwarder_id?: string | null
          fuel_type_id?: string | null
          id?: string
          invoice_number?: string | null
          loading_volume?: number | null
          month?: string | null
          quarter?: string | null
          railway_tariff?: number | null
          registry_type?: Database["public"]["Enums"]["deal_type"]
          rounded_tonnage_from_forwarder?: number | null
          row_number?: number | null
          shipment_month?: string | null
          shipment_volume?: number | null
          shipped_tonnage_amount?: number | null
          supplier_id?: string | null
          updated_at?: string | null
          wagon_number?: string | null
          waybill_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipment_registry_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "counterparties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_registry_company_group_id_fkey"
            columns: ["company_group_id"]
            isOneToOne: false
            referencedRelation: "company_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_registry_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_registry_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_registry_departure_station_id_fkey"
            columns: ["departure_station_id"]
            isOneToOne: false
            referencedRelation: "stations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_registry_destination_station_id_fkey"
            columns: ["destination_station_id"]
            isOneToOne: false
            referencedRelation: "stations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_registry_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_registry_forwarder_id_fkey"
            columns: ["forwarder_id"]
            isOneToOne: false
            referencedRelation: "forwarders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_registry_fuel_type_id_fkey"
            columns: ["fuel_type_id"]
            isOneToOne: false
            referencedRelation: "fuel_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_registry_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "counterparties"
            referencedColumns: ["id"]
          },
        ]
      }
      snt_documents: {
        Row: {
          deal_id: string | null
          goods_description: string | null
          id: string
          imported_at: string | null
          imported_by: string | null
          price_per_unit: number | null
          quantity: number | null
          raw_data: Json | null
          receiver_bin: string | null
          receiver_name: string | null
          registration_datetime: string | null
          registration_number: string | null
          shipment_date: string | null
          snt_number: string | null
          source_file_path: string | null
          supplier_bin: string | null
          supplier_name: string | null
          total_amount: number | null
          unit: string | null
        }
        Insert: {
          deal_id?: string | null
          goods_description?: string | null
          id?: string
          imported_at?: string | null
          imported_by?: string | null
          price_per_unit?: number | null
          quantity?: number | null
          raw_data?: Json | null
          receiver_bin?: string | null
          receiver_name?: string | null
          registration_datetime?: string | null
          registration_number?: string | null
          shipment_date?: string | null
          snt_number?: string | null
          source_file_path?: string | null
          supplier_bin?: string | null
          supplier_name?: string | null
          total_amount?: number | null
          unit?: string | null
        }
        Update: {
          deal_id?: string | null
          goods_description?: string | null
          id?: string
          imported_at?: string | null
          imported_by?: string | null
          price_per_unit?: number | null
          quantity?: number | null
          raw_data?: Json | null
          receiver_bin?: string | null
          receiver_name?: string | null
          registration_datetime?: string | null
          registration_number?: string | null
          shipment_date?: string | null
          snt_number?: string | null
          source_file_path?: string | null
          supplier_bin?: string | null
          supplier_name?: string | null
          total_amount?: number | null
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "snt_documents_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "snt_documents_imported_by_fkey"
            columns: ["imported_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      stations: {
        Row: {
          code: string | null
          created_at: string | null
          default_factory_id: string | null
          id: string
          is_active: boolean | null
          name: string
          type: string
          updated_at: string | null
        }
        Insert: {
          code?: string | null
          created_at?: string | null
          default_factory_id?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          type: string
          updated_at?: string | null
        }
        Update: {
          code?: string | null
          created_at?: string | null
          default_factory_id?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stations_default_factory_id_fkey"
            columns: ["default_factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
        ]
      }
      stores: {
        Row: {
          created_at: string
          id: string
          is_connected: boolean
          is_demo: boolean | null
          kaspi_api_key: string | null
          kaspi_merchant_id: string | null
          last_sync_at: string | null
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_connected?: boolean
          is_demo?: boolean | null
          kaspi_api_key?: string | null
          kaspi_merchant_id?: string | null
          last_sync_at?: string | null
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_connected?: boolean
          is_demo?: boolean | null
          kaspi_api_key?: string | null
          kaspi_merchant_id?: string | null
          last_sync_at?: string | null
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stores_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      surcharges: {
        Row: {
          accepted_amount: number | null
          accounted_amount_quarter: number | null
          accounted_quarter: number | null
          amount: number | null
          approval_status: string | null
          buyer_contract: string | null
          claim_number: string | null
          claimed_amount: number | null
          comment: string | null
          created_at: string | null
          deal_id: string | null
          deal_passport_number: string | null
          departure_station_id: string | null
          destination_station_id: string | null
          fuel_type_id: string | null
          id: string
          issue_date: string | null
          issued_by_name: string | null
          issued_to_name: string | null
          paid_amount: number | null
          payment_date: string | null
          period: string | null
          reason: string
          reinvoice_acceptance_status: string | null
          reinvoice_accepted_amount: number | null
          reinvoice_amount: number | null
          reinvoice_code: string | null
          reinvoice_comment: string | null
          reinvoice_date: string | null
          reinvoice_letter: string | null
          reinvoice_paid_amount: number | null
          reinvoice_payment_date: string | null
          reinvoice_remaining_debt: number | null
          reinvoice_response_date: string | null
          reinvoiced_from: string | null
          reinvoiced_to: string | null
          remaining_debt: number | null
          shipped_volume: number | null
          supplier_contract: string | null
          surcharge_code: string | null
          updated_at: string | null
        }
        Insert: {
          accepted_amount?: number | null
          accounted_amount_quarter?: number | null
          accounted_quarter?: number | null
          amount?: number | null
          approval_status?: string | null
          buyer_contract?: string | null
          claim_number?: string | null
          claimed_amount?: number | null
          comment?: string | null
          created_at?: string | null
          deal_id?: string | null
          deal_passport_number?: string | null
          departure_station_id?: string | null
          destination_station_id?: string | null
          fuel_type_id?: string | null
          id?: string
          issue_date?: string | null
          issued_by_name?: string | null
          issued_to_name?: string | null
          paid_amount?: number | null
          payment_date?: string | null
          period?: string | null
          reason: string
          reinvoice_acceptance_status?: string | null
          reinvoice_accepted_amount?: number | null
          reinvoice_amount?: number | null
          reinvoice_code?: string | null
          reinvoice_comment?: string | null
          reinvoice_date?: string | null
          reinvoice_letter?: string | null
          reinvoice_paid_amount?: number | null
          reinvoice_payment_date?: string | null
          reinvoice_remaining_debt?: number | null
          reinvoice_response_date?: string | null
          reinvoiced_from?: string | null
          reinvoiced_to?: string | null
          remaining_debt?: number | null
          shipped_volume?: number | null
          supplier_contract?: string | null
          surcharge_code?: string | null
          updated_at?: string | null
        }
        Update: {
          accepted_amount?: number | null
          accounted_amount_quarter?: number | null
          accounted_quarter?: number | null
          amount?: number | null
          approval_status?: string | null
          buyer_contract?: string | null
          claim_number?: string | null
          claimed_amount?: number | null
          comment?: string | null
          created_at?: string | null
          deal_id?: string | null
          deal_passport_number?: string | null
          departure_station_id?: string | null
          destination_station_id?: string | null
          fuel_type_id?: string | null
          id?: string
          issue_date?: string | null
          issued_by_name?: string | null
          issued_to_name?: string | null
          paid_amount?: number | null
          payment_date?: string | null
          period?: string | null
          reason?: string
          reinvoice_acceptance_status?: string | null
          reinvoice_accepted_amount?: number | null
          reinvoice_amount?: number | null
          reinvoice_code?: string | null
          reinvoice_comment?: string | null
          reinvoice_date?: string | null
          reinvoice_letter?: string | null
          reinvoice_paid_amount?: number | null
          reinvoice_payment_date?: string | null
          reinvoice_remaining_debt?: number | null
          reinvoice_response_date?: string | null
          reinvoiced_from?: string | null
          reinvoiced_to?: string | null
          remaining_debt?: number | null
          shipped_volume?: number | null
          supplier_contract?: string | null
          surcharge_code?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "surcharges_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "surcharges_departure_station_id_fkey"
            columns: ["departure_station_id"]
            isOneToOne: false
            referencedRelation: "stations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "surcharges_destination_station_id_fkey"
            columns: ["destination_station_id"]
            isOneToOne: false
            referencedRelation: "stations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "surcharges_fuel_type_id_fkey"
            columns: ["fuel_type_id"]
            isOneToOne: false
            referencedRelation: "fuel_types"
            referencedColumns: ["id"]
          },
        ]
      }
      tariffs: {
        Row: {
          created_at: string | null
          departure_station_id: string | null
          destination_station_id: string | null
          factory_id: string | null
          forwarder_id: string | null
          fuel_type_id: string | null
          id: string
          month: string
          norm_days: number | null
          planned_tariff: number | null
          updated_at: string | null
          year: number
        }
        Insert: {
          created_at?: string | null
          departure_station_id?: string | null
          destination_station_id?: string | null
          factory_id?: string | null
          forwarder_id?: string | null
          fuel_type_id?: string | null
          id?: string
          month: string
          norm_days?: number | null
          planned_tariff?: number | null
          updated_at?: string | null
          year: number
        }
        Update: {
          created_at?: string | null
          departure_station_id?: string | null
          destination_station_id?: string | null
          factory_id?: string | null
          forwarder_id?: string | null
          fuel_type_id?: string | null
          id?: string
          month?: string
          norm_days?: number | null
          planned_tariff?: number | null
          updated_at?: string | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "tariffs_departure_station_id_fkey"
            columns: ["departure_station_id"]
            isOneToOne: false
            referencedRelation: "stations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tariffs_destination_station_id_fkey"
            columns: ["destination_station_id"]
            isOneToOne: false
            referencedRelation: "stations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tariffs_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tariffs_forwarder_id_fkey"
            columns: ["forwarder_id"]
            isOneToOne: false
            referencedRelation: "forwarders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tariffs_fuel_type_id_fkey"
            columns: ["fuel_type_id"]
            isOneToOne: false
            referencedRelation: "fuel_types"
            referencedColumns: ["id"]
          },
        ]
      }
      user_discovery_settings: {
        Row: {
          cargo_rate_per_kg: number | null
          demand_threshold: number | null
          excluded_categories: string[] | null
          margin_threshold_pct: number | null
          packaging: number | null
          updated_at: string | null
          user_id: string
          yuan_rate: number | null
          zone: string | null
        }
        Insert: {
          cargo_rate_per_kg?: number | null
          demand_threshold?: number | null
          excluded_categories?: string[] | null
          margin_threshold_pct?: number | null
          packaging?: number | null
          updated_at?: string | null
          user_id: string
          yuan_rate?: number | null
          zone?: string | null
        }
        Update: {
          cargo_rate_per_kg?: number | null
          demand_threshold?: number | null
          excluded_categories?: string[] | null
          margin_threshold_pct?: number | null
          packaging?: number | null
          updated_at?: string | null
          user_id?: string
          yuan_rate?: number | null
          zone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_discovery_settings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string
          email: string
          id: string
          name: string
          plan: string
          updated_at: string
          whatsapp_phone: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id: string
          name?: string
          plan?: string
          updated_at?: string
          whatsapp_phone?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          name?: string
          plan?: string
          updated_at?: string
          whatsapp_phone?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      compute_dt_kt_balance: {
        Args: {
          p_company_group_id: string
          p_forwarder_id: string
          p_year: number
        }
        Returns: number
      }
      detect_price_drops: {
        Args: { p_store_id: string; p_threshold_percent: number }
        Returns: {
          competitor_name: string
          drop_percent: number
          new_price: number
          old_price: number
          product_name: string
        }[]
      }
      find_similar_by_embedding: {
        Args: {
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          brand: string
          image_url: string
          kaspi_product_id: string
          price: number
          product_title: string
          product_url: string
          rating: number
          review_count: number
          similarity: number
        }[]
      }
      find_similar_images: {
        Args: { max_distance?: number; query_hash: unknown }
        Returns: {
          brand: string
          distance: number
          image_url: string
          kaspi_product_id: string
          price: number
          product_title: string
          product_url: string
          rating: number
          review_count: number
        }[]
      }
      generate_deal_number: {
        Args: {
          p_type: Database["public"]["Enums"]["deal_type"]
          p_year: number
        }
        Returns: number
      }
      is_admin: { Args: never; Returns: boolean }
      is_writable_role: { Args: never; Returns: boolean }
      lookup_tariff: {
        Args: {
          p_dep_station_id: string
          p_dest_station_id: string
          p_forwarder_id: string
          p_fuel_type_id: string
          p_month: string
          p_year: number
        }
        Returns: number
      }
      refresh_deal_esf_totals: {
        Args: { p_deal_id: string }
        Returns: undefined
      }
      refresh_deal_payment_totals: {
        Args: { p_deal_id: string }
        Returns: undefined
      }
      refresh_deal_price_totals: {
        Args: { p_deal_id: string }
        Returns: undefined
      }
      refresh_deal_shipment_totals: {
        Args: { p_deal_id: string }
        Returns: undefined
      }
      refresh_quotation_averages: {
        Args: { p_month: number; p_product_type_id: string; p_year: number }
        Returns: undefined
      }
      search_by_image: {
        Args: {
          match_count?: number
          min_similarity?: number
          query_embedding: string
        }
        Returns: {
          brand: string
          image_url: string
          kaspi_id: string
          price: number
          rating: number
          review_count: number
          similarity: number
          title: string
        }[]
      }
    }
    Enums: {
      deal_type: "KG" | "KZ" | "OIL"
      price_condition: "average_month" | "fixed" | "trigger" | "manual"
      trigger_basis: "shipment_date" | "border_crossing_date"
      user_role: "admin" | "manager" | "logistics" | "accounting" | "readonly"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      deal_type: ["KG", "KZ", "OIL"],
      price_condition: ["average_month", "fixed", "trigger", "manual"],
      trigger_basis: ["shipment_date", "border_crossing_date"],
      user_role: ["admin", "manager", "logistics", "accounting", "readonly"],
    },
  },
} as const

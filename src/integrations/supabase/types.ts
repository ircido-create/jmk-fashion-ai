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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      accounts_payable: {
        Row: {
          amount: number
          category: string | null
          created_at: string
          description: string | null
          due_date: string
          id: string
          paid_at: string | null
          status: Database["public"]["Enums"]["payment_status"]
          supplier: string
          updated_at: string
        }
        Insert: {
          amount: number
          category?: string | null
          created_at?: string
          description?: string | null
          due_date: string
          id?: string
          paid_at?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          supplier: string
          updated_at?: string
        }
        Update: {
          amount?: number
          category?: string | null
          created_at?: string
          description?: string | null
          due_date?: string
          id?: string
          paid_at?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          supplier?: string
          updated_at?: string
        }
        Relationships: []
      }
      accounts_receivable: {
        Row: {
          amount: number
          created_at: string
          customer_id: string | null
          description: string | null
          due_date: string
          id: string
          paid_at: string | null
          sale_id: string | null
          status: Database["public"]["Enums"]["payment_status"]
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          customer_id?: string | null
          description?: string | null
          due_date: string
          id?: string
          paid_at?: string | null
          sale_id?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          customer_id?: string | null
          description?: string | null
          due_date?: string
          id?: string
          paid_at?: string | null
          sale_id?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_receivable_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_receivable_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_blocked_contacts: {
        Row: {
          created_at: string
          id: string
          note: string | null
          phone: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          phone: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          phone?: string
        }
        Relationships: []
      }
      ai_settings: {
        Row: {
          ai_paused: boolean
          id: string
          persona: string
          pix_key: string | null
          pix_key_type: string | null
          pix_recipient_name: string | null
          system_prompt: string
          updated_at: string
        }
        Insert: {
          ai_paused?: boolean
          id?: string
          persona?: string
          pix_key?: string | null
          pix_key_type?: string | null
          pix_recipient_name?: string | null
          system_prompt?: string
          updated_at?: string
        }
        Update: {
          ai_paused?: boolean
          id?: string
          persona?: string
          pix_key?: string | null
          pix_key_type?: string | null
          pix_recipient_name?: string | null
          system_prompt?: string
          updated_at?: string
        }
        Relationships: []
      }
      customer_merge_ignored: {
        Row: {
          created_at: string
          customer_a_id: string
          customer_b_id: string
          id: string
        }
        Insert: {
          created_at?: string
          customer_a_id: string
          customer_b_id: string
          id?: string
        }
        Update: {
          created_at?: string
          customer_a_id?: string
          customer_b_id?: string
          id?: string
        }
        Relationships: []
      }
      customers: {
        Row: {
          address: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          nickname: string | null
          notes: string | null
          phone: string | null
          tax_id: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          nickname?: string | null
          notes?: string | null
          phone?: string | null
          tax_id?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          nickname?: string | null
          notes?: string | null
          phone?: string | null
          tax_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      dunning_logs: {
        Row: {
          customer_id: string | null
          id: string
          message: string | null
          receivable_id: string | null
          sent_at: string
        }
        Insert: {
          customer_id?: string | null
          id?: string
          message?: string | null
          receivable_id?: string | null
          sent_at?: string
        }
        Update: {
          customer_id?: string | null
          id?: string
          message?: string | null
          receivable_id?: string | null
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dunning_logs_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dunning_logs_receivable_id_fkey"
            columns: ["receivable_id"]
            isOneToOne: false
            referencedRelation: "accounts_receivable"
            referencedColumns: ["id"]
          },
        ]
      }
      dunning_runs: {
        Row: {
          enviadas: number | null
          erro: string | null
          falhadas: number | null
          finished_at: string | null
          id: string
          origem: string
          started_at: string
          status: string
          total: number | null
        }
        Insert: {
          enviadas?: number | null
          erro?: string | null
          falhadas?: number | null
          finished_at?: string | null
          id?: string
          origem?: string
          started_at?: string
          status?: string
          total?: number | null
        }
        Update: {
          enviadas?: number | null
          erro?: string | null
          falhadas?: number | null
          finished_at?: string | null
          id?: string
          origem?: string
          started_at?: string
          status?: string
          total?: number | null
        }
        Relationships: []
      }
      favorite_stickers: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          public_url: string
          storage_path: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          public_url: string
          storage_path: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          public_url?: string
          storage_path?: string
        }
        Relationships: []
      }
      imported_romaneios: {
        Row: {
          created_at: string
          file_hash: string
          filename: string | null
          id: string
          imported_by: string | null
          items_count: number | null
          storage_path: string | null
          supplier: string | null
          total: number | null
        }
        Insert: {
          created_at?: string
          file_hash: string
          filename?: string | null
          id?: string
          imported_by?: string | null
          items_count?: number | null
          storage_path?: string | null
          supplier?: string | null
          total?: number | null
        }
        Update: {
          created_at?: string
          file_hash?: string
          filename?: string | null
          id?: string
          imported_by?: string | null
          items_count?: number | null
          storage_path?: string | null
          supplier?: string | null
          total?: number | null
        }
        Relationships: []
      }
      payment_proofs: {
        Row: {
          ai_amount: number | null
          ai_bank: string | null
          ai_is_payment_proof: boolean | null
          ai_payer_name: string | null
          ai_summary: string | null
          ai_transaction_id: string | null
          bucket: string
          created_at: string
          created_by: string | null
          customer_id: string | null
          description: string | null
          file_size: number | null
          id: string
          mime_type: string | null
          original_filename: string | null
          payment_date: string
          source: string
          storage_path: string
          whatsapp_message_id: string | null
        }
        Insert: {
          ai_amount?: number | null
          ai_bank?: string | null
          ai_is_payment_proof?: boolean | null
          ai_payer_name?: string | null
          ai_summary?: string | null
          ai_transaction_id?: string | null
          bucket?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          description?: string | null
          file_size?: number | null
          id?: string
          mime_type?: string | null
          original_filename?: string | null
          payment_date?: string
          source?: string
          storage_path: string
          whatsapp_message_id?: string | null
        }
        Update: {
          ai_amount?: number | null
          ai_bank?: string | null
          ai_is_payment_proof?: boolean | null
          ai_payer_name?: string | null
          ai_summary?: string | null
          ai_transaction_id?: string | null
          bucket?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          description?: string | null
          file_size?: number | null
          id?: string
          mime_type?: string | null
          original_filename?: string | null
          payment_date?: string
          source?: string
          storage_path?: string
          whatsapp_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_proofs_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_proofs_whatsapp_message_id_fkey"
            columns: ["whatsapp_message_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      pre_sale_items: {
        Row: {
          code: string | null
          color: string | null
          created_at: string
          description: string
          id: string
          notes: string | null
          photo_url: string | null
          pre_sale_id: string
          product_id: string | null
          quantity: number
          raw_ocr: Json | null
          size: string | null
          subtotal: number
          supplier: string | null
          unit_price: number
          variant_id: string | null
        }
        Insert: {
          code?: string | null
          color?: string | null
          created_at?: string
          description: string
          id?: string
          notes?: string | null
          photo_url?: string | null
          pre_sale_id: string
          product_id?: string | null
          quantity?: number
          raw_ocr?: Json | null
          size?: string | null
          subtotal?: number
          supplier?: string | null
          unit_price?: number
          variant_id?: string | null
        }
        Update: {
          code?: string | null
          color?: string | null
          created_at?: string
          description?: string
          id?: string
          notes?: string | null
          photo_url?: string | null
          pre_sale_id?: string
          product_id?: string | null
          quantity?: number
          raw_ocr?: Json | null
          size?: string | null
          subtotal?: number
          supplier?: string | null
          unit_price?: number
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pre_sale_items_pre_sale_id_fkey"
            columns: ["pre_sale_id"]
            isOneToOne: false
            referencedRelation: "pre_sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pre_sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pre_sale_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      pre_sales: {
        Row: {
          created_at: string
          customer_id: string | null
          discount: number
          id: string
          notes: string | null
          seller_id: string | null
          status: Database["public"]["Enums"]["pre_sale_status"]
          total: number
          updated_at: string
          whatsapp_sent_at: string | null
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          discount?: number
          id?: string
          notes?: string | null
          seller_id?: string | null
          status?: Database["public"]["Enums"]["pre_sale_status"]
          total?: number
          updated_at?: string
          whatsapp_sent_at?: string | null
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          discount?: number
          id?: string
          notes?: string | null
          seller_id?: string | null
          status?: Database["public"]["Enums"]["pre_sale_status"]
          total?: number
          updated_at?: string
          whatsapp_sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pre_sales_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variants: {
        Row: {
          color: string | null
          created_at: string
          id: string
          image_url: string | null
          product_id: string
          quantity: number
          size: string | null
          sku: string | null
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          product_id: string
          quantity?: number
          size?: string | null
          sku?: string | null
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          product_id?: string
          quantity?: number
          size?: string | null
          sku?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          active: boolean
          category: string | null
          cost: number
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          is_draft: boolean
          low_stock_threshold: number
          name: string
          price: number
          sku: string | null
          supplier: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          category?: string | null
          cost?: number
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_draft?: boolean
          low_stock_threshold?: number
          name: string
          price?: number
          sku?: string | null
          supplier?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          category?: string | null
          cost?: number
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_draft?: boolean
          low_stock_threshold?: number
          name?: string
          price?: number
          sku?: string | null
          supplier?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          active: boolean
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      receivable_payments: {
        Row: {
          amount_paid: number
          created_at: string
          id: string
          proof_id: string
          receivable_id: string
        }
        Insert: {
          amount_paid?: number
          created_at?: string
          id?: string
          proof_id: string
          receivable_id: string
        }
        Update: {
          amount_paid?: number
          created_at?: string
          id?: string
          proof_id?: string
          receivable_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "receivable_payments_proof_id_fkey"
            columns: ["proof_id"]
            isOneToOne: false
            referencedRelation: "payment_proofs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receivable_payments_receivable_id_fkey"
            columns: ["receivable_id"]
            isOneToOne: false
            referencedRelation: "accounts_receivable"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_items: {
        Row: {
          created_at: string
          id: string
          product_id: string | null
          product_name: string
          quantity: number
          sale_id: string
          unit_cost: number
          unit_price: number
          variant_id: string | null
          variant_label: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          product_id?: string | null
          product_name: string
          quantity?: number
          sale_id: string
          unit_cost?: number
          unit_price?: number
          variant_id?: string | null
          variant_label?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string | null
          product_name?: string
          quantity?: number
          sale_id?: string
          unit_cost?: number
          unit_price?: number
          variant_id?: string | null
          variant_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          created_at: string
          customer_id: string | null
          id: string
          installments: number | null
          notes: string | null
          payment_method: string | null
          receivable_id: string | null
          sale_date: string
          total: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          id?: string
          installments?: number | null
          notes?: string | null
          payment_method?: string | null
          receivable_id?: string | null
          sale_date?: string
          total?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          id?: string
          installments?: number | null
          notes?: string | null
          payment_method?: string | null
          receivable_id?: string | null
          sale_date?: string
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_receivable_id_fkey"
            columns: ["receivable_id"]
            isOneToOne: false
            referencedRelation: "accounts_receivable"
            referencedColumns: ["id"]
          },
        ]
      }
      status_posts: {
        Row: {
          caption: string | null
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          image_url: string | null
          posted_at: string
          product_id: string
          variant_id: string | null
        }
        Insert: {
          caption?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          image_url?: string | null
          posted_at?: string
          product_id: string
          variant_id?: string | null
        }
        Update: {
          caption?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          image_url?: string | null
          posted_at?: string
          product_id?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "status_posts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "status_posts_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      status_reaction_sent: {
        Row: {
          created_at: string
          id: string
          phone: string
          target_key: string
        }
        Insert: {
          created_at?: string
          id?: string
          phone: string
          target_key: string
        }
        Update: {
          created_at?: string
          id?: string
          phone?: string
          target_key?: string
        }
        Relationships: []
      }
      supplier_sites: {
        Row: {
          created_at: string
          domain: string
          id: string
          supplier_name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          domain: string
          id?: string
          supplier_name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          domain?: string
          id?: string
          supplier_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      voice_clones: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          sample_storage_path: string | null
          updated_at: string
          voice_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          sample_storage_path?: string | null
          updated_at?: string
          voice_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          sample_storage_path?: string | null
          updated_at?: string
          voice_id?: string
        }
        Relationships: []
      }
      whatsapp_config: {
        Row: {
          access_token: string | null
          app_secret: string | null
          enabled: boolean
          id: string
          last_error_at: string | null
          last_error_message: string | null
          phone_number_id: string | null
          updated_at: string
          verify_token: string | null
          waba_id: string | null
        }
        Insert: {
          access_token?: string | null
          app_secret?: string | null
          enabled?: boolean
          id?: string
          last_error_at?: string | null
          last_error_message?: string | null
          phone_number_id?: string | null
          updated_at?: string
          verify_token?: string | null
          waba_id?: string | null
        }
        Update: {
          access_token?: string | null
          app_secret?: string | null
          enabled?: boolean
          id?: string
          last_error_at?: string | null
          last_error_message?: string | null
          phone_number_id?: string | null
          updated_at?: string
          verify_token?: string | null
          waba_id?: string | null
        }
        Relationships: []
      }
      whatsapp_conversations: {
        Row: {
          ai_handoff: boolean
          created_at: string
          customer_id: string | null
          customer_phone: string
          display_name: string | null
          id: string
          last_message_at: string
          last_message_preview: string | null
          unread_count: number
        }
        Insert: {
          ai_handoff?: boolean
          created_at?: string
          customer_id?: string | null
          customer_phone: string
          display_name?: string | null
          id?: string
          last_message_at?: string
          last_message_preview?: string | null
          unread_count?: number
        }
        Update: {
          ai_handoff?: boolean
          created_at?: string
          customer_id?: string | null
          customer_phone?: string
          display_name?: string | null
          id?: string
          last_message_at?: string
          last_message_preview?: string | null
          unread_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_conversations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          direction: Database["public"]["Enums"]["message_direction"]
          id: string
          media_filename: string | null
          media_mime: string | null
          media_path: string | null
          media_type: string | null
          quoted_caption: string | null
          quoted_is_status: boolean
          quoted_thumbnail_path: string | null
          sent_at: string | null
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          direction: Database["public"]["Enums"]["message_direction"]
          id?: string
          media_filename?: string | null
          media_mime?: string | null
          media_path?: string | null
          media_type?: string | null
          quoted_caption?: string | null
          quoted_is_status?: boolean
          quoted_thumbnail_path?: string | null
          sent_at?: string | null
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          direction?: Database["public"]["Enums"]["message_direction"]
          id?: string
          media_filename?: string | null
          media_mime?: string | null
          media_path?: string | null
          media_type?: string | null
          quoted_caption?: string | null
          quoted_is_status?: boolean
          quoted_thumbnail_path?: string | null
          sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      bump_conversation_unread: {
        Args: { conv_id: string }
        Returns: undefined
      }
      create_sale: {
        Args: {
          p_customer_id: string
          p_installments: number
          p_items: Json
          p_notes: string | null
          p_payment_method: string
          p_receivables?: Json
          p_total: number
        }
        Returns: string
      }
      decrement_variant_stock: {
        Args: { qty: number; variant_id: string }
        Returns: number
      }
      get_due_today_receivables_to_dunning: {
        Args: { p_limit?: number; p_today?: string }
        Returns: {
          amount: number
          customer_id: string
          customers: Json
          description: string
          due_date: string
          id: string
        }[]
      }
      get_overdue_receivables_to_dunning: {
        Args: {
          p_limit?: number
          p_max_dias_vencido?: number
          p_today?: string
        }
        Returns: {
          amount: number
          customer_id: string
          customers: Json
          description: string
          due_date: string
          id: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_variant_stock: {
        Args: { qty: number; variant_id: string }
        Returns: number
      }
    }
    Enums: {
      app_role: "admin" | "vendedor"
      message_direction: "inbound" | "outbound"
      payment_status: "pendente" | "pago" | "vencido" | "cancelado"
      pre_sale_status:
        | "aguardando_aprovacao"
        | "aguardando_compra"
        | "em_compra"
        | "recebido"
        | "pronto_entrega"
        | "finalizado"
        | "cancelado"
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
      app_role: ["admin", "vendedor"],
      message_direction: ["inbound", "outbound"],
      payment_status: ["pendente", "pago", "vencido", "cancelado"],
      pre_sale_status: [
        "aguardando_aprovacao",
        "aguardando_compra",
        "em_compra",
        "recebido",
        "pronto_entrega",
        "finalizado",
        "cancelado",
      ],
    },
  },
} as const

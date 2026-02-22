import Joi from 'joi';
import { passwordPolicy, getPasswordPolicyMessage } from '../utils/passwordPolicy.js';

export const validate = (schema) => (req, res, next) => {
    const { body, params, query } = req;
    const dataToValidate = {
        body: Object.keys(body || {}).length ? body : undefined,
        params: Object.keys(params || {}).length ? params : undefined,
        query: Object.keys(query || {}).length ? query : undefined
    };

    const { error, value } = schema.validate(dataToValidate, {
        abortEarly: false,
        stripUnknown: true,
        allowUnknown: false
    });

    if (error) {
        const details = error.details.map((d) => ({
            message: d.message,
            path: d.path
        }));
        return res.status(400).json({
            error: 'validation_error',
            message: 'Datos de entrada invalidos',
            details
        });
    }

    if (value.body) req.body = value.body;
    if (value.params) req.params = value.params;
    if (value.query) {
        if (req.query && typeof req.query === 'object') {
            for (const key of Object.keys(req.query)) {
                delete req.query[key];
            }
            Object.assign(req.query, value.query);
        } else {
            req.validatedQuery = value.query;
        }
    }

    next();
};

const uuid = Joi.string().pattern(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);
const optionalUuid = uuid.allow(null, '');
const isoDate = Joi.date().iso();

const orderPaymentMethod = Joi.string().valid('cash', 'transfer', 'credit_account', 'card', 'debit_card', 'credit_card', 'qr');
const shiftPaymentMethod = Joi.string().valid('cash', 'debit_card', 'credit_card', 'card', 'transfer', 'qr', 'credit_account', 'other');
const paginationQuery = {
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(500),
    offset: Joi.number().integer().min(0)
};
const strongPassword = Joi.string()
    .min(passwordPolicy.minLength)
    .max(passwordPolicy.maxLength)
    .pattern(passwordPolicy.regex)
    .messages({
        'string.pattern.base': getPasswordPolicyMessage(),
        'string.min': getPasswordPolicyMessage(),
        'string.max': getPasswordPolicyMessage()
    });

export const schemas = {
    emptyQuery: Joi.object({
        query: Joi.object({}).max(0)
    }),

    idParam: Joi.object({
        params: Joi.object({
            id: uuid.required()
        })
    }),

    login: Joi.object({
        body: Joi.object({
            email: Joi.string().email().required(),
            password: Joi.string().min(1).required()
        })
    }),

    user: Joi.object({
        body: Joi.object({
            name: Joi.string().min(2).max(255).required(),
            email: Joi.string().email().required(),
            password: strongPassword.required(),
            role: Joi.string().valid('admin', 'manager', 'cashier', 'warehouse').required()
        })
    }),

    userUpdate: Joi.object({
        params: Joi.object({
            id: uuid.required()
        }),
        body: Joi.object({
            name: Joi.string().min(2).max(255).required(),
            email: Joi.string().email().required(),
            password: strongPassword.optional().allow('', null),
            role: Joi.string().valid('admin', 'manager', 'cashier', 'warehouse').required(),
            status: Joi.string().valid('active', 'inactive').required()
        })
    }),

    product: Joi.object({
        body: Joi.object({
            sku: Joi.string().required(),
            barcode: Joi.string().allow('', null),
            name: Joi.string().required(),
            description: Joi.string().allow('', null),
            category: Joi.string().allow('', null),
            image_url: Joi.string().max(2048).allow('', null),
            location: Joi.string().allow('', null),
            purchase_price: Joi.number().min(0),
            cost_price: Joi.number().min(0),
            sale_price: Joi.number().min(0),
            stock_initial: Joi.number().integer().min(0).optional(),
            status: Joi.string().valid('active', 'inactive').optional()
        })
    }),

    uploadProductImage: Joi.object({
        body: Joi.object({
            data_url: Joi.string().max(2_200_000).required()
        })
    }),

    productFilters: Joi.object({
        query: Joi.object({
            supplier_id: optionalUuid,
            ...paginationQuery
        })
    }),

    order: Joi.object({
        body: Joi.object({
            client_id: optionalUuid,
            customer_name: Joi.string().allow('', null),
            total_amount: Joi.number().min(0).optional(),
            payment_method: orderPaymentMethod.optional(),
            shipping_address: Joi.string().allow('', null),
            items: Joi.array().items(Joi.object({
                product_id: uuid.required(),
                quantity: Joi.number().integer().min(1).required()
            })).min(1).required()
        })
    }),

    orderFilters: Joi.object({
        query: Joi.object({
            client_id: optionalUuid,
            status: Joi.string().valid('pending', 'confirmed', 'paid', 'packed', 'dispatched', 'delivered', 'completed', 'cancelled', 'returned'),
            ...paginationQuery
        })
    }),

    orderStatus: Joi.object({
        params: Joi.object({
            id: uuid.required()
        }),
        body: Joi.object({
            status: Joi.string().valid('pending', 'confirmed', 'paid', 'packed', 'dispatched', 'delivered', 'completed', 'cancelled', 'returned').required()
        })
    }),

    orderDispatch: Joi.object({
        params: Joi.object({
            id: uuid.required()
        }),
        body: Joi.object({
            shipping_method: Joi.string().valid('pickup', 'delivery').required(),
            tracking_number: Joi.string().max(100).allow('', null),
            estimated_delivery: isoDate.allow('', null),
            shipping_address: Joi.string().allow('', null),
            recipient_name: Joi.string().allow('', null),
            recipient_dni: Joi.string().allow('', null)
        })
    }),

    orderDeliver: Joi.object({
        params: Joi.object({
            id: uuid.required()
        }),
        body: Joi.object({
            recipient_name: Joi.string().min(1).required(),
            recipient_dni: Joi.string().min(1).required(),
            delivery_notes: Joi.string().allow('', null)
        })
    }),

    orderInvoice: Joi.object({
        params: Joi.object({
            id: uuid.required()
        }),
        body: Joi.object({
            payments: Joi.array().items(
                Joi.object({
                    method: orderPaymentMethod.required(),
                    amount: Joi.number().positive().required()
                })
            ).min(1).optional(),
            notes: Joi.string().allow('', null)
        })
    }),

    orderItemPick: Joi.object({
        params: Joi.object({
            id: uuid.required()
        }),
        body: Joi.object({
            picked_quantity: Joi.number().integer().min(0).required()
        })
    }),

    purchaseOrder: Joi.object({
        body: Joi.object({
            supplier_id: uuid.required(),
            order_date: Joi.date().required(),
            expected_delivery_date: Joi.date().allow(null, ''),
            items: Joi.array().items(
                Joi.object({
                    product_id: uuid.required(),
                    quantity_ordered: Joi.number().integer().min(1),
                    quantity: Joi.number().integer().min(1),
                    unit_cost: Joi.number().min(0).required()
                }).xor('quantity_ordered', 'quantity')
            ).min(1).required(),
            notes: Joi.string().allow('', null)
        })
    }),

    purchaseOrderFilters: Joi.object({
        query: Joi.object({
            supplier_id: optionalUuid,
            status: Joi.string().valid('draft', 'sent', 'partial', 'received', 'cancelled')
        })
    }),

    purchaseOrderStatus: Joi.object({
        params: Joi.object({
            id: uuid.required()
        }),
        body: Joi.object({
            status: Joi.string().valid('draft', 'sent', 'partial', 'received', 'cancelled').required()
        })
    }),

    reception: Joi.object({
        body: Joi.object({
            purchase_order_id: optionalUuid,
            supplier_id: uuid.required(),
            remito_number: Joi.string().allow('', null),
            items: Joi.array().items(Joi.object({
                product_id: uuid.required(),
                po_item_id: optionalUuid,
                quantity_expected: Joi.number().integer().min(0).optional(),
                quantity_received: Joi.number().integer().min(0).required(),
                unit_cost: Joi.number().min(0).optional(),
                location_assigned: Joi.string().allow('', null),
                batch_number: Joi.string().allow('', null),
                expiration_date: Joi.date().allow(null, ''),
                status: Joi.string().valid('approved', 'rejected').optional(),
                notes: Joi.string().allow('', null)
            })).min(1).required(),
            notes: Joi.string().allow('', null)
        })
    }),

    receptionFilters: Joi.object({
        query: Joi.object({
            supplier_id: optionalUuid,
            status: Joi.string().valid('pending_qc', 'approved', 'partially_approved', 'rejected')
        })
    }),

    approveReception: Joi.object({
        params: Joi.object({
            id: uuid.required()
        }),
        body: Joi.object({
            approved_by: optionalUuid
        })
    }),

    supplierReturnFilters: Joi.object({
        query: Joi.object({
            supplier_id: optionalUuid,
            status: Joi.string().valid('draft', 'approved', 'rejected', 'cancelled')
        })
    }),

    supplierReturnCreate: Joi.object({
        body: Joi.object({
            supplier_id: uuid.required(),
            notes: Joi.string().allow('', null),
            items: Joi.array().items(
                Joi.object({
                    product_id: uuid.required(),
                    quantity: Joi.number().positive().required(),
                    unit_cost: Joi.number().min(0).optional(),
                    reason: Joi.string().allow('', null)
                })
            ).min(1).required()
        })
    }),

    supplierPaymentFilters: Joi.object({
        query: Joi.object({
            supplier_id: optionalUuid
        })
    }),

    supplierPaymentCreate: Joi.object({
        body: Joi.object({
            supplier_id: uuid.required(),
            payment_date: isoDate.allow('', null),
            notes: Joi.string().allow('', null),
            payments: Joi.array().items(
                Joi.object({
                    amount: Joi.number().positive().required(),
                    payment_method: Joi.string().min(1).max(100).optional(),
                    reference_number: Joi.string().allow('', null)
                })
            ).min(1).required()
        })
    }),

    qualityCheck: Joi.object({
        body: Joi.object({
            reception_id: uuid.required(),
            product_id: uuid.required(),
            inspector_id: optionalUuid,
            result: Joi.string().valid('pass', 'fail', 'conditional').required(),
            quantity_checked: Joi.number().integer().min(0).required(),
            quantity_passed: Joi.number().integer().min(0).required(),
            quantity_failed: Joi.number().integer().min(0).required(),
            defect_description: Joi.string().allow('', null),
            action_taken: Joi.string().valid('approve', 'reject', 'return_to_supplier', 'discount').optional(),
            notes: Joi.string().allow('', null)
        })
    }),

    invoiceFilters: Joi.object({
        query: Joi.object({
            client_id: optionalUuid,
            status: Joi.string().valid('issued', 'authorized', 'cancelled'),
            start_date: isoDate,
            end_date: isoDate
        })
    }),

    invoiceItemsQuery: Joi.object({
        query: Joi.object({
            invoice_id: uuid.required()
        }).required()
    }),

    manualInvoice: Joi.object({
        body: Joi.object({
            client_id: optionalUuid,
            customer_name: Joi.string().allow('', null),
            invoice_type: Joi.string().valid('A', 'B', 'C', 'TK').optional(),
            point_of_sale: Joi.number().integer().min(1).optional(),
            order_id: optionalUuid,
            notes: Joi.string().allow('', null),
            payment_method: orderPaymentMethod.optional(),
            items: Joi.array().items(
                Joi.object({
                    product_id: optionalUuid,
                    description: Joi.string().allow('', null),
                    product_name: Joi.string().allow('', null),
                    sku: Joi.string().allow('', null),
                    quantity: Joi.number().positive().required(),
                    unit_price: Joi.number().min(0).required(),
                    discount_percentage: Joi.number().min(0).max(100).optional(),
                    discount: Joi.number().min(0).max(100).optional(),
                    vat_rate: Joi.number().min(0).max(100).optional()
                }).or('description', 'product_name', 'product_id')
            ).min(1).required()
        })
    }),

    inventoryMovementFilters: Joi.object({
        query: Joi.object({
            product_id: optionalUuid,
            type: Joi.string().max(50),
            start_date: isoDate,
            end_date: isoDate,
            limit: Joi.number().integer().min(1).max(500)
        })
    }),

    inventoryMovementCreate: Joi.object({
        body: Joi.object({
            type: Joi.string().max(50).required(),
            product_id: uuid.required(),
            from_location: Joi.string().allow('', null),
            to_location: Joi.string().allow('', null),
            quantity: Joi.number().positive().required(),
            unit_cost: Joi.number().min(0).optional(),
            reason: Joi.string().allow('', null),
            reference_type: Joi.string().allow('', null),
            reference_id: Joi.string().allow('', null),
            notes: Joi.string().allow('', null),
            performed_by: optionalUuid
        })
    }),

    batchFilters: Joi.object({
        query: Joi.object({
            product_id: optionalUuid,
            status: Joi.string().max(50)
        })
    }),

    batchCreate: Joi.object({
        body: Joi.object({
            product_id: uuid.required(),
            batch_number: Joi.string().min(1).max(100).required(),
            manufacturing_date: isoDate.allow('', null),
            expiration_date: isoDate.allow('', null),
            supplier_id: optionalUuid,
            quantity_initial: Joi.number().positive().required(),
            location: Joi.string().allow('', null),
            notes: Joi.string().allow('', null)
        })
    }),

    batchUpdate: Joi.object({
        params: Joi.object({
            id: uuid.required()
        }),
        body: Joi.object({
            quantity_current: Joi.number().min(0).required(),
            status: Joi.string().max(50).optional()
        })
    }),

    serialFilters: Joi.object({
        query: Joi.object({
            product_id: optionalUuid,
            status: Joi.string().max(50)
        })
    }),

    serialCreate: Joi.object({
        body: Joi.object({
            product_id: uuid.required(),
            serial_number: Joi.string().min(1).max(255).required(),
            batch_id: optionalUuid,
            location: Joi.string().allow('', null),
            warranty_months: Joi.number().integer().min(0).optional()
        })
    }),

    serialUpdate: Joi.object({
        params: Joi.object({
            id: uuid.required()
        }),
        body: Joi.object({
            status: Joi.string().max(50).optional(),
            sold_to_client_id: optionalUuid,
            sold_in_order_id: optionalUuid,
            location: Joi.string().allow('', null)
        }).min(1)
    }),

    client: Joi.object({
        body: Joi.object({
            name: Joi.string().min(2).max(255).required(),
            email: Joi.string().email().allow('', null),
            phone: Joi.string().allow('', null),
            tax_id: Joi.string().allow('', null),
            address: Joi.string().allow('', null),
            credit_limit: Joi.number().min(0).optional()
        })
    }),

    clientUpdate: Joi.object({
        params: Joi.object({
            id: uuid.required()
        }),
        body: Joi.object({
            name: Joi.string().min(2).max(255).required(),
            email: Joi.string().email().allow('', null),
            phone: Joi.string().allow('', null),
            tax_id: Joi.string().allow('', null),
            address: Joi.string().allow('', null),
            credit_limit: Joi.number().min(0).optional()
        })
    }),

    supplier: Joi.object({
        body: Joi.object({
            name: Joi.string().min(2).max(255).required(),
            contact_name: Joi.string().allow('', null),
            email: Joi.string().email().allow('', null),
            phone: Joi.string().allow('', null),
            tax_id: Joi.string().allow('', null),
            address: Joi.string().allow('', null),
            category: Joi.string().allow('', null),
            account_balance: Joi.number().optional()
        })
    }),

    supplierUpdate: Joi.object({
        params: Joi.object({
            id: uuid.required()
        }),
        body: Joi.object({
            name: Joi.string().min(2).max(255).required(),
            contact_name: Joi.string().allow('', null),
            email: Joi.string().email().allow('', null),
            phone: Joi.string().allow('', null),
            tax_id: Joi.string().allow('', null),
            address: Joi.string().allow('', null),
            category: Joi.string().allow('', null),
            account_balance: Joi.number().optional()
        })
    }),

    companySettingsUpdate: Joi.object({
        body: Joi.object({
            identity: Joi.object({
                brand_name: Joi.string().allow('', null),
                legal_name: Joi.string().allow('', null),
                tax_id: Joi.string().allow('', null),
                logo_url: Joi.string().allow('', null)
            }).optional(),
            contact: Joi.object({
                phone: Joi.string().allow('', null),
                email: Joi.string().email().allow('', null),
                website: Joi.string().allow('', null)
            }).optional(),
            address: Joi.object({
                street: Joi.string().allow('', null),
                number: Joi.string().allow('', null),
                city: Joi.string().allow('', null),
                state: Joi.string().allow('', null),
                zip: Joi.string().allow('', null)
            }).optional(),
            socials: Joi.object({
                instagram: Joi.string().allow('', null),
                facebook: Joi.string().allow('', null),
                linkedin: Joi.string().allow('', null)
            }).optional(),
            operation: Joi.object({
                tax_rate: Joi.number().min(0).max(100).optional(),
                default_currency: Joi.string().length(3).optional()
            }).optional()
        }).min(1)
    }),

    auditLogsFilters: Joi.object({
        query: Joi.object({
            entity_type: Joi.string().max(100),
            entity_id: Joi.string().max(100),
            ...paginationQuery
        })
    }),

    transactionsFilters: Joi.object({
        query: Joi.object({
            supplier_id: optionalUuid,
            client_id: optionalUuid,
            type: Joi.string().max(50)
        })
    }),

    cashTransaction: Joi.object({
        body: Joi.object({
            register_id: uuid.required(),
            type: Joi.string().valid('income', 'expense').required(),
            amount: Joi.number().positive().required(),
            reason: Joi.string().required(),
            notes: Joi.string().allow('', null)
        })
    }),

    cashShiftOpen: Joi.object({
        params: Joi.object({
            id: uuid.required()
        }),
        body: Joi.object({
            opening_balance: Joi.number().min(0).required(),
            opened_by: optionalUuid
        })
    }),

    cashShiftClose: Joi.object({
        params: Joi.object({
            id: uuid.required()
        }),
        body: Joi.object({
            actual_balance: Joi.number().min(0).required(),
            notes: Joi.string().allow('', null),
            closed_by: optionalUuid
        })
    }),

    shiftPayment: Joi.object({
        params: Joi.object({
            id: uuid.required()
        }),
        body: Joi.object({
            order_id: optionalUuid,
            payment_method: shiftPaymentMethod.optional(),
            amount: Joi.number().positive().required(),
            type: Joi.string().valid('sale', 'income', 'refund', 'expense').optional()
        })
    }),

    warrantiesFilters: Joi.object({
        query: Joi.object({
            client_id: optionalUuid,
            status: Joi.string().max(50)
        })
    }),

    warrantyCreate: Joi.object({
        body: Joi.object({
            client_id: optionalUuid,
            customer_name: Joi.string().allow('', null),
            product_id: uuid.required(),
            serial_number: Joi.string().allow('', null),
            issue_description: Joi.string().min(1).required()
        })
    }),

    warrantyStatusUpdate: Joi.object({
        params: Joi.object({
            id: uuid.required()
        }),
        body: Joi.object({
            status: Joi.string().valid(
                'initiated',
                'received',
                'in_progress',
                'resolved',
                'rejected',
                'closed',
                'sent_to_supplier',
                'supplier_approved',
                'supplier_rejected'
            ).required(),
            resolution_type: Joi.string().valid('repaired', 'replaced', 'refunded').allow('', null),
            resolution_notes: Joi.string().allow('', null),
            notes: Joi.string().allow('', null)
        })
    }),

    clientReturnsFilters: Joi.object({
        query: Joi.object({
            client_id: optionalUuid,
            status: Joi.string().valid('pending', 'approved', 'rejected', 'cancelled')
        })
    }),

    clientReturnCreate: Joi.object({
        body: Joi.object({
            client_id: optionalUuid,
            customer_name: Joi.string().allow('', null),
            order_id: optionalUuid,
            reason: Joi.string().allow('', null),
            items: Joi.array().items(
                Joi.object({
                    product_id: uuid.required(),
                    quantity: Joi.number().integer().min(1).required(),
                    condition_status: Joi.string().valid('sellable', 'damaged', 'used', 'open_box', 'other').optional(),
                    unit_price: Joi.number().min(0).optional()
                })
            ).min(1).optional()
        })
    }),

    creditNotesFilters: Joi.object({
        query: Joi.object({
            client_id: optionalUuid
        })
    }),

    creditNoteCreate: Joi.object({
        body: Joi.object({
            client_id: uuid.required(),
            amount: Joi.number().positive().required(),
            reason: Joi.string().allow('', null),
            reference_type: Joi.string().valid('return', 'warranty', 'discount', 'other', 'manual').allow('', null),
            reference_id: optionalUuid,
            notes: Joi.string().allow('', null)
        })
    })
};

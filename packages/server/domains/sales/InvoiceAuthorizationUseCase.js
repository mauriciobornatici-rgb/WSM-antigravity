import defaultArcaAuthorization from '../fiscal/ArcaAuthorizationService.js';
import { invoiceArcaAdapter } from '../fiscal/arcaAdapters.js';

// ADR-020: the invoice is authorized through the shared ARCA flow (lost answers, crashes and
// concurrency are settled by asking ARCA for the exact number requested; never a double CAE).
export class InvoiceAuthorizationUseCase {
    constructor({ arcaAuthorization = defaultArcaAuthorization } = {}) {
        this.arcaAuthorization = arcaAuthorization;
    }

    async execute(invoiceId, userId) {
        return this.arcaAuthorization.authorize(invoiceArcaAdapter, invoiceId, userId);
    }
}

export default new InvoiceAuthorizationUseCase();

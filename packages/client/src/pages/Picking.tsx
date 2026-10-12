import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/services/api";
import { queryKeys } from "@/lib/queryKeys";
import type { Order } from "@/types";
import { showErrorToast } from "@/lib/errorHandling";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { usePickingSession } from "@/hooks/usePickingSession";
import { playScanErrorBeep, playScanSuccessBeep } from "@/lib/scanAudio";
import { BarcodeScannerDialog } from "@/components/inventory/BarcodeScannerDialog";
import { PickingHeader } from "@/components/picking/PickingHeader";
import { PickingScannerCard } from "@/components/picking/PickingScannerCard";
import { PickingItemsGrid } from "@/components/picking/PickingItemsGrid";
import { PickingOrdersTable } from "@/components/picking/PickingOrdersTable";

import {
    isPickableStatus,
    itemIsComplete,
    itemRemainingQuantity,
    orderHasShortage,
    orderMissingQuantity,
    orderPickedQuantity,
    orderTotalQuantity,
    readyStatusLabel,
    sortItemsByLocation,
    toPickedFlag,
} from "@/lib/pickingUtils";

export default function PickingPage() {
    const { id } = useParams<{ id?: string }>();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [orders, setOrders] = useState<Order[]>([]);
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    const [scannerInput, setScannerInput] = useState("");
    const [pendingScanItemId, setPendingScanItemId] = useState<string | null>(null);
    const [pendingScanQuantity, setPendingScanQuantity] = useState<number>(1);
    const [loading, setLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [cameraScannerOpen, setCameraScannerOpen] = useState(false);

    const [routeDirection, setRouteDirection] = useState<'desc' | 'asc'>('asc');
    const [pickingStep, setPickingStep] = useState<'location' | 'barcode' | 'quantity'>('location');
    const [isLocationVerified, setIsLocationVerified] = useState(false);
    const [isBarcodeVerified, setIsBarcodeVerified] = useState(false);

    const selectItemForPicking = useCallback((item: Order["items"][number]) => {
        setPendingScanItemId(item.id);
        const remaining = Math.max(1, Number(item.quantity || 0) - Number(item.picked_quantity || 0));
        setPendingScanQuantity(remaining);
        
        const hasNoLocation = !item.location || item.location.trim().toLowerCase() === "general" || item.location.trim() === "";
        if (hasNoLocation) {
            setPickingStep('barcode');
            setIsLocationVerified(true);
        } else {
            setPickingStep('location');
            setIsLocationVerified(false);
        }
        setIsBarcodeVerified(false);
    }, []);

    const loadOrders = useCallback(async () => {
        try {
            setLoading(true);
            setErrorMessage(null);
            const response = await api.getOrders();
            const normalized = response.map((order) => toPickedFlag(sortItemsByLocation(order, false)));
            setOrders(normalized);
            if (id) {
                const found = normalized.find((order) => order.id === id);
                setSelectedOrder(found ?? null);
            }
        } catch (error) {
            setErrorMessage("No se pudieron cargar los pedidos para picking.");
            showErrorToast("Error al cargar pedidos", error);
        } finally {
            setLoading(false);
        }
    }, [id]);

    useEffect(() => {
        void loadOrders();
    }, [loadOrders]);

    const completion = useMemo(() => {
        if (!selectedOrder) return 0;
        const total = orderTotalQuantity(selectedOrder);
        if (total === 0) return 0;
        const picked = orderPickedQuantity(selectedOrder);
        return Math.round((picked / total) * 100);
    }, [selectedOrder]);

    const sortedItems = useMemo(() => {
        if (!selectedOrder) return [];
        return sortItemsByLocation(selectedOrder, routeDirection === "desc").items;
    }, [selectedOrder, routeDirection]);

    const pendingScanItem = useMemo(() => {
        if (!selectedOrder || !pendingScanItemId) return null;
        return selectedOrder.items.find((item) => item.id === pendingScanItemId) ?? null;
    }, [pendingScanItemId, selectedOrder]);

    const pendingScanRemaining = pendingScanItem ? itemRemainingQuantity(pendingScanItem) : 0;
    const canPick = selectedOrder ? isPickableStatus(selectedOrder.status) : false;

    const { transitionToPacked } = usePickingSession();

    const handleCameraScan = useCallback((value: string) => {
        setScannerInput(value);
        setCameraScannerOpen(false);
        toast.info("Código leído", { description: "Presiona Buscar SKU para procesarlo." });
    }, []);

    useEffect(() => {
        if (!pendingScanItem) return;
        if (pendingScanQuantity > pendingScanRemaining) {
            setPendingScanQuantity(Math.max(1, pendingScanRemaining));
        }
    }, [pendingScanItem, pendingScanQuantity, pendingScanRemaining]);

    async function handleScan(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!selectedOrder) return;
        if (!canPick) {
            toast.warning("Este picking ya esta cerrado.");
            return;
        }

        const scannedText = scannerInput.toUpperCase().trim();
        setScannerInput("");
        if (!scannedText) return;

        // CASE 1: There is an active pending item
        if (pendingScanItem) {
            if (pickingStep === 'location') {
                const targetLoc = (pendingScanItem.location || "").toUpperCase().trim();
                if (scannedText === targetLoc) {
                    setIsLocationVerified(true);
                    setPickingStep('barcode');
                    toast.success("¡Ubicación confirmada!");
                    playScanSuccessBeep();
                    void api.recordPickingEvent(selectedOrder.id, {
                        product_id: pendingScanItem.product_id,
                        action_type: 'location_verified',
                        location_code: targetLoc
                    });
                } else {
                    playScanErrorBeep();
                    toast.error(`Ubicación incorrecta: ${scannedText}`, {
                        description: `Debes ir a la ubicación: ${pendingScanItem.location || "Sin ubicación"}`,
                    });
                }
            } else if (pickingStep === 'barcode') {
                const skuMatch = pendingScanItem.sku.toUpperCase() === scannedText;
                const barcodeMatch = pendingScanItem.barcode && pendingScanItem.barcode.toUpperCase() === scannedText;
                if (skuMatch || barcodeMatch) {
                    setIsBarcodeVerified(true);
                    setPickingStep('quantity');
                    toast.success("¡Producto verificado!");
                    playScanSuccessBeep();
                    void api.recordPickingEvent(selectedOrder.id, {
                        product_id: pendingScanItem.product_id,
                        action_type: 'barcode_scanned',
                        barcode_scanned: scannedText
                    });
                } else {
                    playScanErrorBeep();
                    toast.error(`Producto incorrecto`, {
                        description: `Se esperaba el SKU/Código: ${pendingScanItem.sku}`,
                    });
                }
            }
            return;
        }

        // CASE 2: No active pending item, let's look up by scanned location, SKU, or barcode!
        const matchingLocItem = sortedItems.find(
            (item) => (item.location || "").toUpperCase().trim() === scannedText && itemRemainingQuantity(item) > 0
        );
        if (matchingLocItem) {
            selectItemForPicking(matchingLocItem);
            toast.info(`Ubicación detectada: ${matchingLocItem.location}`, {
                description: `Iniciando recolección de ${matchingLocItem.product_name}`,
            });
            return;
        }

        const matchingProductItem = sortedItems.find(
            (item) =>
                (item.sku.toUpperCase() === scannedText || (item.barcode && item.barcode.toUpperCase() === scannedText)) &&
                itemRemainingQuantity(item) > 0
        );
        if (matchingProductItem) {
            selectItemForPicking(matchingProductItem);
            toast.success(`Producto detectado: ${matchingProductItem.product_name}`);
            return;
        }

        toast.error("Código no reconocido", {
            description: `El código ${scannedText} no coincide con ninguna ubicación o producto pendiente en este pedido.`,
        });
    }

    async function confirmPendingScan() {
        if (!selectedOrder || !pendingScanItem) return;
        if (!canPick) {
            toast.warning("El pedido ya no admite picking.");
            return;
        }

        const currentPicked = Number(pendingScanItem.picked_quantity || 0);
        const remaining = itemRemainingQuantity(pendingScanItem);
        if (remaining <= 0) {
            toast.info("Este item ya esta completo.");
            setPendingScanItemId(null);
            setPendingScanQuantity(1);
            return;
        }

        const quantityToAdd = Math.max(1, Math.min(Number(pendingScanQuantity || 1), remaining));
        const nextPicked = currentPicked + quantityToAdd;

        const nextItems = selectedOrder.items.map((item) =>
            item.id === pendingScanItem.id
                ? {
                    ...item,
                    picked_quantity: nextPicked,
                    picked: nextPicked >= Number(item.quantity || 0),
                }
                : item,
        );
        const nextOrder: Order = { ...selectedOrder, items: nextItems };
        const allPicked = nextItems.every((item) => itemIsComplete(item));

        setSelectedOrder(nextOrder);

        try {
            await api.pickOrderItem(pendingScanItem.id, nextPicked);
        } catch (error) {
            showErrorToast("Error al registrar cantidad", error);
            await loadOrders();
            return;
        }

        if (allPicked) {
            try {
                await transitionToPacked(selectedOrder.id);
                toast.success("Picking finalizado", {
                    description: `Pedido ${selectedOrder.id}: ${readyStatusLabel(selectedOrder)}.`,
                });
                setPendingScanItemId(null);
                setPendingScanQuantity(1);
                await queryClient.invalidateQueries({ queryKey: queryKeys.orders.all });
                await loadOrders();
                return;
            } catch (error) {
                showErrorToast("Cantidad guardada, pero no se pudo cerrar el picking", error);
                setPendingScanItemId(null);
                setPendingScanQuantity(1);
                await loadOrders();
                return;
            }
        }

        toast.success("Cantidad registrada", {
            description: `${pendingScanItem.product_name} (${nextPicked}/${pendingScanItem.quantity})`,
        });

        // Auto-advance to the next incomplete item along the sorted route!
        const nextIncompleteItem = sortItemsByLocation(nextOrder, routeDirection === "desc").items.find(
            (item) => Number(item.picked_quantity || 0) < Number(item.quantity || 0),
        );

        if (nextIncompleteItem) {
            selectItemForPicking(nextIncompleteItem);
        } else {
            setPendingScanItemId(null);
            setPendingScanQuantity(1);
        }
    }

    async function closeWithMissing() {
        if (!selectedOrder) return;
        if (!canPick) {
            toast.info("El picking ya estaba cerrado.");
            return;
        }

        const missing = orderMissingQuantity(selectedOrder);
        if (missing <= 0) {
            toast.info("No hay faltantes para cerrar.");
            return;
        }

        const confirmed = window.confirm(`Se cerrara el picking con faltantes (${missing} unidades). Deseas continuar?`);
        if (!confirmed) return;
        try {
            void api.recordPickingEvent(selectedOrder.id, {
                product_id: "order_shortage_close",
                action_type: "shortage_closed",
                quantity: missing,
            });
            await transitionToPacked(selectedOrder.id);
            setPendingScanItemId(null);
            setPendingScanQuantity(1);
            toast.warning("Picking cerrado con faltantes", {
                description: `${readyStatusLabel(selectedOrder)} con ${missing} unidades pendientes.`,
            });
            await queryClient.invalidateQueries({ queryKey: queryKeys.orders.all });
            await loadOrders();
        } catch (error) {
            showErrorToast("Error al cerrar picking", error);
        }
    }

    async function finalizePicking() {
        if (!selectedOrder) return;
        if (!canPick) {
            toast.info("El picking ya estaba cerrado.");
            return;
        }

        const missing = orderMissingQuantity(selectedOrder);
        if (missing > 0) {
            toast.error(`Todavia hay faltantes (${missing}). Usa "Cerrar con faltantes" o completa el picking.`);
            return;
        }

        try {
            await transitionToPacked(selectedOrder.id);
            setPendingScanItemId(null);
            setPendingScanQuantity(1);
            toast.success("Picking finalizado", {
                description: `Pedido ${selectedOrder.id}: ${readyStatusLabel(selectedOrder)}.`,
            });
            await queryClient.invalidateQueries({ queryKey: queryKeys.orders.all });
            await loadOrders();
            navigate("/orders");
        } catch (error) {
            showErrorToast("No se pudo finalizar el picking", error);
        }
    }

    if (loading) {
        return (
            <div className="flex h-64 items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" />
            </div>
        );
    }

    if (errorMessage && !selectedOrder) {
        return (
            <Card>
                <CardContent className="space-y-4 p-8 text-center">
                    <p className="text-sm text-muted-foreground">{errorMessage}</p>
                    <Button onClick={() => void loadOrders()}>Reintentar</Button>
                </CardContent>
            </Card>
        );
    }

    if (selectedOrder) {
        const completed = selectedOrder.items.every((item) => itemIsComplete(item));
        const hasShortage = orderHasShortage(selectedOrder);
        const missingQuantity = orderMissingQuantity(selectedOrder);
        const canFinalizeNow = canPick && missingQuantity === 0;
        const packedWithShortage = selectedOrder.status === "packed" && hasShortage;
        const packedComplete = selectedOrder.status === "packed" && !hasShortage;

        return (
            <div className="space-y-6">
                <PickingHeader
                    order={selectedOrder}
                    completion={completion}
                    canPick={canPick}
                    missingQuantity={missingQuantity}
                    hasShortage={hasShortage}
                    routeDirection={routeDirection}
                    onRouteChange={setRouteDirection}
                    onBack={() => navigate("/orders")}
                />

                <PickingScannerCard
                    order={selectedOrder}
                    canPick={canPick}
                    packedWithShortage={packedWithShortage}
                    completed={completed}
                    packedComplete={packedComplete}
                    scannerInput={scannerInput}
                    onScannerInputChange={setScannerInput}
                    onScanSubmit={handleScan}
                    onOpenCamera={() => setCameraScannerOpen(true)}
                    canFinalizeNow={canFinalizeNow}
                    missingQuantity={missingQuantity}
                    onFinalize={() => void finalizePicking()}
                    onCloseWithMissing={() => void closeWithMissing()}
                    pendingScanItem={pendingScanItem}
                    pickingStep={pickingStep}
                    isLocationVerified={isLocationVerified}
                    isBarcodeVerified={isBarcodeVerified}
                    pendingScanQuantity={pendingScanQuantity}
                    pendingScanRemaining={pendingScanRemaining}
                    onQuantityChange={setPendingScanQuantity}
                    onConfirmManualLocation={() => {
                        if (!pendingScanItem) return;
                        setIsLocationVerified(true);
                        setPickingStep('barcode');
                        toast.success("¡Ubicación confirmada manualmente!");
                        void api.recordPickingEvent(selectedOrder.id, {
                            product_id: pendingScanItem.product_id,
                            action_type: 'location_verified_manual',
                            location_code: pendingScanItem.location
                        });
                    }}
                    onConfirmManualBarcode={() => {
                        if (!pendingScanItem) return;
                        setIsBarcodeVerified(true);
                        setPickingStep('quantity');
                        toast.success("¡Producto verificado manualmente!");
                        void api.recordPickingEvent(selectedOrder.id, {
                            product_id: pendingScanItem.product_id,
                            action_type: 'barcode_scanned_manual',
                            barcode_scanned: pendingScanItem.sku
                        });
                    }}
                    onCancelPendingScan={() => {
                        setPendingScanItemId(null);
                        setPendingScanQuantity(1);
                    }}
                    onConfirmPendingScan={() => void confirmPendingScan()}
                />

                <PickingItemsGrid
                    items={sortedItems}
                    canPick={canPick}
                    pendingScanItemId={pendingScanItemId}
                    onSelectItem={selectItemForPicking}
                />

                <BarcodeScannerDialog
                    open={cameraScannerOpen}
                    onOpenChange={setCameraScannerOpen}
                    title={pickingStep === "location" ? "Escanear ubicación" : "Escanear producto"}
                    description={pickingStep === "location" ? "Lee el código de la posición indicada." : "Lee el SKU o código de barras del artículo."}
                    onDetected={handleCameraScan}
                />
            </div>
        );
    }

    return (
        <PickingOrdersTable
            orders={orders}
            onSelectOrder={(order) => {
                setSelectedOrder(toPickedFlag(sortItemsByLocation(order, false)));
            }}
        />
    );
}

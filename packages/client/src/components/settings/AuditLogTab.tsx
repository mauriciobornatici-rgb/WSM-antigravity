import { Eye } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { PaginationControls } from "@/components/common/PaginationControls"
import { safeJsonParse } from "@/lib/errorHandling"
import type { AuditLogEntry, PaginationMeta } from "@/types/api"

interface AuditLogTabProps {
    auditLogs: AuditLogEntry[]
    auditLoading: boolean
    auditPagination: PaginationMeta | null
    auditPage: number
    onPageChange: (page: number) => void
}

export function AuditLogTab({
    auditLogs,
    auditLoading,
    auditPagination,
    auditPage,
    onPageChange
}: AuditLogTabProps) {
    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>Historial de Modificaciones</CardTitle>
                    <CardDescription>Registro completo de acciones realizadas por los usuarios en el sistema.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="overflow-x-auto">
                        <Table className="min-w-[900px]">
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Fecha</TableHead>
                                    <TableHead>Usuario</TableHead>
                                    <TableHead>Acción</TableHead>
                                    <TableHead>Entidad</TableHead>
                                    <TableHead>IP</TableHead>
                                    <TableHead className="text-right">Detalles</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {auditLoading ? (
                                    <TableRow>
                                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                                            Cargando auditoria...
                                        </TableCell>
                                    </TableRow>
                                ) : auditLogs.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                                            No hay registros de auditoría disponibles.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    auditLogs.map((log) => (
                                        <TableRow key={log.id}>
                                            <TableCell className="text-sm">
                                                {new Date(log.created_at).toLocaleString()}
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex flex-col">
                                                    <span className="font-medium">{log.user_name || 'Sistema'}</span>
                                                    <span className="text-xs text-muted-foreground">{log.user_email || ''}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-semibold uppercase">
                                                    {log.action.replace(/_/g, ' ')}
                                                </code>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex flex-col">
                                                    <span className="capitalize">{log.entity_type}</span>
                                                    <span className="text-[10px] font-mono text-muted-foreground">{log.entity_id}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-xs text-muted-foreground">
                                                {log.ip_address || '-'}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <Dialog>
                                                    <DialogTrigger asChild>
                                                        <Button variant="ghost" size="icon">
                                                            <Eye className="h-4 w-4" />
                                                        </Button>
                                                    </DialogTrigger>
                                                    <DialogContent className="w-[95vw] max-h-[92vh] overflow-y-auto sm:max-w-2xl">
                                                        <DialogHeader>
                                                            <DialogTitle>Detalles del Cambio</DialogTitle>
                                                            <DialogDescription>
                                                                Acción: {log.action} | Ejecutado por: {log.user_name || 'Sistema'}
                                                            </DialogDescription>
                                                        </DialogHeader>
                                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                                                            <div className="space-y-2">
                                                                <h4 className="text-sm font-semibold">Valores Anteriores</h4>
                                                                <pre className="bg-muted p-3 rounded text-[10px] overflow-auto max-h-48 border">
                                                                    {log.old_values
                                                                        ? JSON.stringify(safeJsonParse(log.old_values), null, 2)
                                                                        : 'Ninguno'}
                                                                </pre>
                                                            </div>
                                                            <div className="space-y-2">
                                                                <h4 className="text-sm font-semibold text-green-600">Nuevos Valores</h4>
                                                                <pre className="bg-green-50/50 dark:bg-green-950/20 p-3 rounded text-[10px] overflow-auto max-h-48 border border-green-200 dark:border-green-800">
                                                                    {log.new_values
                                                                        ? JSON.stringify(safeJsonParse(log.new_values), null, 2)
                                                                        : 'Ninguno'}
                                                                </pre>
                                                            </div>
                                                        </div>
                                                    </DialogContent>
                                                </Dialog>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                    <PaginationControls
                        page={Math.max(1, Number(auditPagination?.page || auditPage))}
                        totalPages={Math.max(1, Number(auditPagination?.totalPages || 1))}
                        totalCount={Number(auditPagination?.totalCount || auditLogs.length)}
                        itemLabel="registro"
                        isLoading={auditLoading}
                        onPageChange={onPageChange}
                    />
                </CardContent>
            </Card>
        </div>
    )
}

import * as React from "react"
import { z } from "zod"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { 
  useListKeys, 
  useGenerateKey, 
  useRevokeKey, 
  useDeleteKey, 
  useListScripts,
  useResetHwid,
  getListKeysQueryKey 
} from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"
import { Plus, Trash2, KeyRound, Ban, RotateCcw, ShieldCheck, ShieldOff } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card } from "@/components/ui/card"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useToast } from "@/hooks/use-toast"
import { formatDate } from "@/lib/utils"

const DURATION_OPTIONS = [
  { label: "Lifetime", value: "0" },
  { label: "1 Day", value: "1" },
  { label: "3 Days", value: "3" },
  { label: "7 Days", value: "7" },
  { label: "14 Days", value: "14" },
  { label: "30 Days", value: "30" },
  { label: "90 Days", value: "90" },
  { label: "365 Days", value: "365" },
]

const keySchema = z.object({
  scriptId: z.coerce.number().min(1, "Script is required"),
  whitelisted: z.boolean().default(false),
  durationDays: z.string().default("0"),
})

export function Keys() {
  const { data: keys, isLoading: keysLoading } = useListKeys()
  const { data: scripts, isLoading: scriptsLoading } = useListScripts()
  const generateKey = useGenerateKey()
  const revokeKey = useRevokeKey()
  const deleteKey = useDeleteKey()
  const resetHwid = useResetHwid()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [open, setOpen] = React.useState(false)

  const form = useForm<z.infer<typeof keySchema>>({
    resolver: zodResolver(keySchema),
    defaultValues: {
      scriptId: 0,
      whitelisted: false,
      durationDays: "0",
    },
  })

  function onSubmit(values: z.infer<typeof keySchema>) {
    const days = parseInt(values.durationDays, 10)
    const expiresAt = days > 0
      ? new Date(Date.now() + days * 86_400_000).toISOString()
      : undefined

    generateKey.mutate(
      { data: { scriptId: values.scriptId, whitelisted: values.whitelisted, expiresAt } },
      {
        onSuccess: (data) => {
          toast({ title: "Key generated successfully", description: `Key: ${data.key}` })
          setOpen(false)
          form.reset()
          queryClient.invalidateQueries({ queryKey: getListKeysQueryKey() })
        },
        onError: () => {
          toast({ title: "Failed to generate key", variant: "destructive" })
        }
      }
    )
  }

  function handleRevoke(id: number) {
    if (!confirm("Revoke this key? Users will lose access.")) return
    revokeKey.mutate(
      { id },
      {
        onSuccess: () => {
          toast({ title: "Key revoked" })
          queryClient.invalidateQueries({ queryKey: getListKeysQueryKey() })
        }
      }
    )
  }

  function handleDelete(id: number) {
    if (!confirm("Are you sure you want to delete this key?")) return
    deleteKey.mutate(
      { id },
      {
        onSuccess: () => {
          toast({ title: "Key deleted" })
          queryClient.invalidateQueries({ queryKey: getListKeysQueryKey() })
        }
      }
    )
  }

  function handleResetHwid(id: number) {
    resetHwid.mutate(
      { id },
      {
        onSuccess: () => {
          toast({ title: "⚙️ Success! Your HWID has been reset." })
          queryClient.invalidateQueries({ queryKey: getListKeysQueryKey() })
        },
        onError: () => {
          toast({ title: "Failed to reset HWID", variant: "destructive" })
        }
      }
    )
  }

  if (keysLoading || scriptsLoading) return <div>Loading...</div>

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">License Keys</h1>
            <p className="text-muted-foreground mt-1 text-sm">Manage access tokens for your scripts.</p>
          </div>
          
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="mr-2 h-4 w-4" /> Generate Key
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Generate License Key</DialogTitle>
                <DialogDescription>
                  Create a new key to grant access to a specific script.
                </DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="scriptId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Target Script</FormLabel>
                        <Select onValueChange={(val) => field.onChange(val)} value={String(field.value || "")}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select a script" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {scripts?.map(s => (
                              <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="durationDays"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Duration</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select duration" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {DURATION_OPTIONS.map(opt => (
                              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <DialogFooter>
                    <Button type="submit" disabled={generateKey.isPending}>
                      {generateKey.isPending ? "Generating..." : "Generate Key"}
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>

        <Card>
          {keys?.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-center">
              <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                <KeyRound className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-lg font-medium">No keys generated</h3>
              <p className="text-sm text-muted-foreground mt-1 mb-4">
                Generate keys to distribute your scripts.
              </p>
              <Button onClick={() => setOpen(true)} variant="outline">
                Generate Key
              </Button>
            </div>
          ) : (
            <>
              {/* Mobile card list */}
              <div className="md:hidden divide-y divide-border">
                {keys?.map((key) => {
                  const script = scripts?.find(s => s.id === key.scriptId)
                  return (
                    <div key={key.id} className="p-4 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-mono text-xs text-foreground break-all select-all leading-relaxed">{key.key}</p>
                        <div className="flex gap-1 shrink-0">
                          {key.status === 'active' && (
                            <>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost" size="icon"
                                    onClick={() => handleResetHwid(key.id)}
                                    disabled={resetHwid.isPending}
                                    title="Reset HWID"
                                  >
                                    <RotateCcw className="h-4 w-4 text-blue-500" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Reset HWID</TooltipContent>
                              </Tooltip>
                              <Button variant="ghost" size="icon" onClick={() => handleRevoke(key.id)} title="Revoke">
                                <Ban className="h-4 w-4 text-yellow-500" />
                              </Button>
                            </>
                          )}
                          <Button
                            variant="ghost" size="icon"
                            onClick={() => handleDelete(key.id)}
                            className="text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                        <Badge variant={key.status === 'active' ? 'success' : key.status === 'revoked' ? 'destructive' : 'secondary'} className="text-xs">
                          {key.status}
                        </Badge>
                        {/* HWID badge */}
                        {key.hwid ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex items-center gap-1 text-xs text-green-500 font-medium cursor-default">
                                <ShieldCheck className="h-3 w-3" /> HWID locked
                              </span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-[200px] break-all">{key.hwid}</TooltipContent>
                          </Tooltip>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground/60 cursor-default">
                            <ShieldOff className="h-3 w-3" /> No HWID
                          </span>
                        )}
                        {script && <span className="font-medium text-foreground">{script.name}</span>}
                        <span>
                          {key.expiresAt ? `Expires ${formatDate(key.expiresAt)}` : "Lifetime"}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Key</TableHead>
                      <TableHead>Script</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>HWID</TableHead>
                      <TableHead>Expires</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {keys?.map((key) => {
                      const script = scripts?.find(s => s.id === key.scriptId)
                      return (
                        <TableRow key={key.id}>
                          <TableCell className="font-mono text-sm tracking-tight">{key.key}</TableCell>
                          <TableCell>
                            {script ? <span className="font-medium">{script.name}</span> : <span className="text-muted-foreground">-</span>}
                          </TableCell>
                          <TableCell>
                            <Badge variant={key.status === 'active' ? 'success' : key.status === 'revoked' ? 'destructive' : 'secondary'}>
                              {key.status}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {key.hwid ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex items-center gap-1 text-xs text-green-500 font-medium cursor-default">
                                    <ShieldCheck className="h-3.5 w-3.5" /> Locked
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-[260px] break-all font-mono text-xs">{key.hwid}</TooltipContent>
                              </Tooltip>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground/60">
                                <ShieldOff className="h-3.5 w-3.5" /> None
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {key.expiresAt
                              ? formatDate(key.expiresAt)
                              : <span className="text-xs text-muted-foreground/60">Lifetime</span>}
                          </TableCell>
                          <TableCell className="text-muted-foreground">{formatDate(key.createdAt)}</TableCell>
                          <TableCell className="text-right space-x-1">
                            {key.status === 'active' && (
                              <>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => handleResetHwid(key.id)}
                                      disabled={resetHwid.isPending}
                                      title="Reset HWID"
                                    >
                                      <RotateCcw className="h-4 w-4 text-blue-500" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Reset HWID</TooltipContent>
                                </Tooltip>
                                <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  onClick={() => handleRevoke(key.id)}
                                  title="Revoke Key"
                                >
                                  <Ban className="h-4 w-4 text-warning" />
                                </Button>
                              </>
                            )}
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              onClick={() => handleDelete(key.id)}
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              title="Delete Key"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </Card>
      </div>
    </TooltipProvider>
  )
}

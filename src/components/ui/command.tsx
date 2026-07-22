"use client"

import * as React from "react"
import { Command as CommandPrimitive } from "cmdk"

import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  InputGroup,
  InputGroupAddon,
} from "@/components/ui/input-group"
import { SearchIcon, CheckIcon } from "lucide-react"

function Command({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        "flex size-full flex-col overflow-hidden rounded-xl! bg-popover p-1 text-popover-foreground",
        className
      )}
      {...props}
    />
  )
}

function CommandDialog({
  title = "Command Palette",
  description = "Search for a command to run...",
  children,
  className,
  showCloseButton = false,
  ...props
}: Omit<React.ComponentProps<typeof Dialog>, "children"> & {
  title?: string
  description?: string
  className?: string
  showCloseButton?: boolean
  children: React.ReactNode
}) {
  return (
    <Dialog {...props}>
      <DialogHeader className="sr-only">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogContent
        className={cn(
          "top-1/3 translate-y-0 overflow-hidden rounded-xl! p-0",
          className
        )}
        showCloseButton={showCloseButton}
      >
        {children}
      </DialogContent>
    </Dialog>
  )
}

function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div data-slot="command-input-wrapper" className="p-1 pb-0">
      <InputGroup className="h-8! rounded-lg! border-input/30 bg-input/30 shadow-none! *:data-[slot=input-group-addon]:pl-2!">
        <CommandPrimitive.Input
          data-slot="command-input"
          className={cn(
            "w-full text-sm outline-hidden disabled:cursor-not-allowed disabled:opacity-50",
            className
          )}
          {...props}
        />
        <InputGroupAddon>
          <SearchIcon className="size-4 shrink-0 opacity-50" />
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}

function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  const listRef = React.useRef<HTMLDivElement>(null)
  return (
    // relative-обёртка нужна для кастомного бегунка справа. Клиент
    // 2026-07-22: «в отгрузках когда смотришь по датам нужно добавить
    // сбоку бегунок» — список месяцев обрезан по max-height, а native
    // overlay-scrollbar на macOS исчезает через секунду, поэтому не
    // видно, что ниже есть ещё значения. Тот же вывод, что у
    // DoubleScrollX: единственный надёжный путь — рисовать полосу
    // своим DOM-элементом.
    <div className="relative">
      <CommandPrimitive.List
        ref={listRef}
        data-slot="command-list"
        className={cn(
          // ap-scroll-y вместо no-scrollbar (shadcn'овский класс, нигде в
          // проекте не объявленный): на Windows/Linux этого достаточно —
          // там scrollbar классический и место резервирует.
          "ap-scroll-y max-h-72 scroll-py-1 overflow-x-hidden overflow-y-auto outline-none",
          className
        )}
        {...props}
      />
      <ScrollThumbY targetRef={listRef} />
    </div>
  )
}

/**
 * Кастомный вертикальный бегунок поверх правого края прокручиваемого
 * элемента. Виден всегда, пока контент не влезает; тянется мышью.
 */
function ScrollThumbY({
  targetRef,
}: {
  targetRef: React.RefObject<HTMLDivElement | null>
}) {
  const [dim, setDim] = React.useState({ scrollHeight: 0, clientHeight: 0, scrollTop: 0 })
  const [dragging, setDragging] = React.useState(false)
  const dragRef = React.useRef<{ clientY: number; startScrollTop: number } | null>(null)

  React.useLayoutEffect(() => {
    const el = targetRef.current
    if (!el) return
    const measure = () =>
      setDim({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, scrollTop: el.scrollTop })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    // Поиск в списке меняет набор строк → высота контента другая.
    const mo = new MutationObserver(measure)
    mo.observe(el, { childList: true, subtree: true })
    const onScroll = () => setDim((d) => ({ ...d, scrollTop: el.scrollTop }))
    el.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      ro.disconnect()
      mo.disconnect()
      el.removeEventListener("scroll", onScroll)
    }
  }, [targetRef])

  const overflowing = dim.scrollHeight > dim.clientHeight + 1
  if (!overflowing) return null

  const trackHeight = dim.clientHeight
  const thumbHeight = Math.max(24, Math.floor((trackHeight * dim.clientHeight) / dim.scrollHeight))
  const maxThumbTop = Math.max(0, trackHeight - thumbHeight)
  const maxScrollTop = Math.max(1, dim.scrollHeight - dim.clientHeight)
  const thumbTop = (dim.scrollTop / maxScrollTop) * maxThumbTop

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    dragRef.current = { clientY: e.clientY, startScrollTop: dim.scrollTop }
    setDragging(true)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging || !dragRef.current || !targetRef.current) return
    const dy = e.clientY - dragRef.current.clientY
    const scale = maxThumbTop > 0 ? maxScrollTop / maxThumbTop : 0
    targetRef.current.scrollTop = Math.max(
      0,
      Math.min(maxScrollTop, dragRef.current.startScrollTop + dy * scale),
    )
  }
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    ;(e.currentTarget as Element).releasePointerCapture(e.pointerId)
    setDragging(false)
    dragRef.current = null
  }

  return (
    <div
      aria-hidden
      className="absolute top-0 right-0.5 w-1.5"
      style={{ height: trackHeight, pointerEvents: "none" }}
    >
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          position: "absolute",
          top: thumbTop,
          height: thumbHeight,
          width: "100%",
          borderRadius: 3,
          background: dragging ? "#78716c" : "#d6d3d1",
          cursor: dragging ? "grabbing" : "grab",
          pointerEvents: "auto",
          touchAction: "none",
          transition: dragging ? "none" : "background 0.12s",
        }}
      />
    </div>
  )
}

function CommandEmpty({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className={cn("py-6 text-center text-sm", className)}
      {...props}
    />
  )
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        "overflow-hidden p-1 text-foreground **:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:py-1.5 **:[[cmdk-group-heading]]:text-xs **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn("-mx-1 h-px bg-border", className)}
      {...props}
    />
  )
}

function CommandItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "group/command-item relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none in-data-[slot=dialog-content]:rounded-lg! data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-selected:bg-muted data-selected:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 data-selected:*:[svg]:text-foreground",
        className
      )}
      {...props}
    >
      {children}
      <CheckIcon className="ml-auto opacity-0 group-has-data-[slot=command-shortcut]/command-item:hidden group-data-[checked=true]/command-item:opacity-100" />
    </CommandPrimitive.Item>
  )
}

function CommandShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn(
        "ml-auto text-xs tracking-widest text-muted-foreground group-data-selected/command-item:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
}

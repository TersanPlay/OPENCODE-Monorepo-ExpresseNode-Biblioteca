# Brief extraído do plano (Task 2)

### Task 2: Botão personalizado na landing

**Files:**
- Modify: `frontend/src/pages/public/home.tsx`

**Interfaces:**
- Consumes: `ArchitecturePage` via rota `/arquitetura` (Task 1); helpers locais `trackSpotlight`, `Spotlight`, `shellCls`, `coreCls` já existentes em `home.tsx`
- Produces: CTA visual exclusivo no hero, abaixo da busca, apontando para `/arquitetura`

- [ ] **Step 1: Adicionar ícone `Blocks` ao import do lucide**

Linha 2 de `home.tsx`:

```tsx
import { ArrowRight, Blocks, BookOpen, CalendarCheck, Clock3, Globe, Library, Search, ShieldCheck, Sparkles } from 'lucide-react';
```

- [ ] **Step 2: Inserir o CTA após o `</form>` da busca no hero**

Localizar o fechamento `</form>` dentro da primeira `<section>` e inserir logo depois (ainda dentro do container `max-w-7xl`):

```tsx
          <Link
            to="/arquitetura"
            onMouseMove={trackSpotlight}
            className={cn(shellCls, 'mt-5 inline-block max-w-sm')}
          >
            <Spotlight />
            <span className={cn(coreCls, 'flex items-center gap-4 p-4')}>
              <span className="flex size-11 shrink-0 items-center justify-center rounded-control bg-primary-soft text-primary">
                <Blocks className="size-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-[14px] font-bold text-ink">Arquitetura do projeto</span>
                <span className="block text-[12.5px] text-muted">Veja como o sistema foi construído</span>
              </span>
              <ArrowRight className="ml-auto size-4 shrink-0 text-primary transition-transform duration-200 [transition-timing-function:var(--ease)] group-hover:translate-x-1" />
            </span>
          </Link>
```

- [ ] **Step 3: Verificar tipos e build**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: sem erros; build concluído

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/public/home.tsx
git commit -m "feat(architecture-page): botao de arquitetura na landing"
```

---


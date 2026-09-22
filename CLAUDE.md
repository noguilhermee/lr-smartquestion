# CLAUDE.md

As regras oficiais deste repositório ficam em `AGENTS.md`, que é a fonte única da verdade para qualquer assistente de IA. O conteúdo é importado abaixo e deve ser seguido integralmente.

@AGENTS.md

## Observações específicas para o Claude Code

- **Git**: não executar `git commit` nem `git push`. Ao concluir etapas significativas, mostrar os comandos (`git add .`, `git commit -m "..."`, `git push origin main`, `npx vercel --prod`) em bloco de código para o usuário executar (regra 6).
- **Scripts do projeto**: não rodar pipelines, notebooks, cargas ou migrações pelo terminal. Apresentar o comando exato, explicar objetivo e impacto, e pedir que o usuário execute e devolva os logs (regra 12).
- **Supabase**: leitura (`SELECT`), inserção (`INSERT`) e alteração de objetos existentes (`UPDATE`/`DELETE`/`ALTER`/`DROP`/`TRUNCATE`) liberadas. Criar um objeto novo (tabela, coluna, view, função, policy etc.) ainda exige perguntar antes (regra 9).
- **Correções de dados**: sempre na origem (ETL em `scripts/`), nunca no `dashboard/api/*` ou `dashboard/public/*` (regra 13).
- **`análise:`**: responder apenas com a análise técnica do log, sem sugestão de Planner nem de Git (regra 10).
- Ao editar `AGENTS.md`, as mudanças passam a valer aqui automaticamente; não duplicar regras neste arquivo.

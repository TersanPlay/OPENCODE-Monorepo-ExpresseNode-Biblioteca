#!/usr/bin/env python3
"""Etapa 1: analisa categorias dos livros SEM tocar no banco.
Gera JSON para revisao humana (etapa 2 importara os aprovados).
Uso: python classify.py [--limit N] [--skip-enrich]
"""
import json
import re
import sqlite3
import sys
import time
import unicodedata
import urllib.request
from pathlib import Path

BASE = Path(__file__).resolve().parent
DB = BASE / '..' / '..' / 'apps' / 'api' / 'prisma' / 'dev.db'
CACHE = BASE / '.ol-cache.json'
OUT = BASE / 'revisao-categorias.json'

LIMIT = int(sys.argv[sys.argv.index('--limit') + 1]) if '--limit' in sys.argv else 0
SKIP_ENRICH = '--skip-enrich' in sys.argv

TAX = json.loads((BASE / 'taxonomy.json').read_text(encoding='utf-8'))['categories']

# --- Dewey (prefixo -> categoria). Match mais longo vence. None = ambiguo (REVIEW). ---
DEWEY = {
    '004': 'Informática e Computação', '005': 'Informática e Computação', '006': 'Informática e Computação',
    '010': 'Biblioteconomia e Leitura', '020': 'Biblioteconomia e Leitura', '025': 'Biblioteconomia e Leitura',
    '026': 'Biblioteconomia e Leitura', '027': 'Biblioteconomia e Leitura',     '028': None,
    '030': 'Referência e Dicionários', '031': 'Referência e Dicionários', '050': 'Comunicação e Jornalismo', '070': 'Comunicação e Jornalismo',
    '060': None, '080': None, '090': None, '000': None,
    '100': 'Filosofia', '110': 'Filosofia', '120': 'Filosofia', '140': 'Filosofia', '160': 'Filosofia',
    '170': 'Filosofia', '180': 'Filosofia', '190': 'Filosofia', '130': None,
    '150': 'Psicologia', '152': 'Psicologia', '153': 'Psicologia', '154': 'Psicologia', '155': 'Psicologia',
    '157': 'Psicologia', '159': 'Psicologia', '158': 'Autoajuda e Desenvolvimento Pessoal',
    '200': 'Religião e Espiritualidade', '210': 'Religião e Espiritualidade', '220': 'Religião e Espiritualidade',
    '230': 'Religião e Espiritualidade', '240': 'Religião e Espiritualidade', '250': 'Religião e Espiritualidade',
    '260': 'Religião e Espiritualidade', '270': 'Religião e Espiritualidade', '280': 'Religião e Espiritualidade',
    '290': 'Religião e Espiritualidade',
    '300': 'Ciências Sociais', '301': 'Ciências Sociais', '302': 'Ciências Sociais', '303': 'Ciências Sociais',
    '304.2': 'Meio Ambiente e Ecologia', '304': 'Ciências Sociais', '305': 'Ciências Sociais',
    '306': 'Ciências Sociais', '307': 'Ciências Sociais', '310': None,
    '320': 'Política', '321': 'Política', '322': 'Política', '323': 'Política', '324': 'Política',
    '325': 'Política', '326': 'Política', '327': 'Política', '328': 'Política', '329': 'Política',
    '330': 'Economia e Finanças', '331': 'Economia e Finanças', '332': 'Economia e Finanças',
    '333': 'Economia e Finanças', '334': 'Economia e Finanças', '335': 'Economia e Finanças',
    '336': 'Economia e Finanças', '337': 'Economia e Finanças', '338': 'Economia e Finanças', '339': 'Economia e Finanças',
    '340': 'Direito', '341': 'Direito', '342': 'Direito', '343': 'Direito', '344': 'Direito',
    '345': 'Direito', '346': 'Direito', '347': 'Direito', '348': 'Direito', '349': 'Direito',
    '350': 'Administração e Negócios', '351': 'Administração e Negócios', '352': 'Administração e Negócios',
    '353': 'Administração e Negócios', '354': 'Administração e Negócios',
    '355': 'História Geral', '358': 'História Geral', '359': 'História Geral',
    '356': 'Engenharia e Tecnologia', '357': 'Engenharia e Tecnologia',
    '360': 'Ciências Sociais', '361': 'Ciências Sociais', '362': 'Ciências Sociais',
    '363.7': 'Meio Ambiente e Ecologia', '363': 'Ciências Sociais',
    '364': 'Direito', '365': 'Direito', '366': 'Ciências Sociais', '367': 'Ciências Sociais',
    '368': 'Economia e Finanças', '369': 'Ciências Sociais',
    '370': 'Educação e Pedagogia', '371': 'Educação e Pedagogia', '372': 'Educação e Pedagogia',
    '373': 'Educação e Pedagogia', '374': 'Educação e Pedagogia', '375': 'Educação e Pedagogia',
    '376': 'Educação e Pedagogia', '377': 'Educação e Pedagogia', '378': 'Educação e Pedagogia', '379': 'Educação e Pedagogia',
    '381': 'Economia e Finanças', '382': 'Economia e Finanças',
    '383': 'Comunicação e Jornalismo', '384': 'Comunicação e Jornalismo',
    '385': None, '386': None, '387': None, '388': None, '380': None,
    '390': 'Ciências Sociais', '398': 'Ciências Sociais',
    '400': 'Linguagem e Linguística', '410': 'Linguagem e Linguística', '420': 'Linguagem e Linguística',
    '430': 'Linguagem e Linguística', '440': 'Linguagem e Linguística', '450': 'Linguagem e Linguística',
    '460': 'Linguagem e Linguística', '469': 'Linguagem e Linguística', '470': 'Linguagem e Linguística', '490': 'Linguagem e Linguística',
    '500': 'Ciências Naturais', '520': 'Ciências Naturais', '521': 'Ciências Naturais',
    '522': 'Ciências Naturais', '523': 'Ciências Naturais', '524': 'Ciências Naturais',
    '525': 'Ciências Naturais', '526': 'Ciências Naturais', '527': 'Ciências Naturais',
    '528': 'Ciências Naturais', '529': 'Ciências Naturais',
    '530': 'Ciências Naturais', '540': 'Ciências Naturais',
    '550': 'Ciências Naturais', '560': 'Ciências Naturais', '570': 'Ciências Naturais', '580': 'Ciências Naturais',
    '590': 'Ciências Naturais',
    '510': 'Matemática', '511': 'Matemática', '512': 'Matemática', '513': 'Matemática',
    '514': 'Matemática', '515': 'Matemática', '516': 'Matemática', '517': 'Matemática',
    '518': 'Matemática', '519': 'Matemática',
    '600': 'Engenharia e Tecnologia',
    '610': 'Medicina e Saúde', '611': 'Medicina e Saúde', '612': 'Medicina e Saúde',
    '613': 'Medicina e Saúde', '614': 'Medicina e Saúde', '615': 'Medicina e Saúde',
    '616': 'Medicina e Saúde', '617': 'Medicina e Saúde', '618': 'Medicina e Saúde', '619': 'Medicina e Saúde',
    '620': 'Engenharia e Tecnologia', '621': 'Engenharia e Tecnologia', '622': 'Engenharia e Tecnologia',
    '623': 'Engenharia e Tecnologia', '624': 'Engenharia e Tecnologia', '625': 'Engenharia e Tecnologia',
    '626': 'Engenharia e Tecnologia', '627': 'Engenharia e Tecnologia', '628': 'Engenharia e Tecnologia',
    '629': 'Engenharia e Tecnologia',
    '630': 'Agricultura e Pecuária', '631': 'Agricultura e Pecuária', '632': 'Agricultura e Pecuária',
    '633': 'Agricultura e Pecuária', '634': 'Agricultura e Pecuária', '635': 'Agricultura e Pecuária',
    '636': 'Agricultura e Pecuária', '637': 'Agricultura e Pecuária', '638': 'Agricultura e Pecuária',
    '639': 'Esporte e Lazer',
    '640': 'Culinária e Economia Doméstica', '641': 'Culinária e Economia Doméstica',
    '642': 'Culinária e Economia Doméstica', '643': 'Culinária e Economia Doméstica',
    '644': 'Culinária e Economia Doméstica', '645': 'Culinária e Economia Doméstica',
    '646': 'Culinária e Economia Doméstica', '647': 'Culinária e Economia Doméstica',
    '648': 'Culinária e Economia Doméstica', '649': 'Educação e Pedagogia',
    '650': 'Administração e Negócios', '651': 'Administração e Negócios', '652': 'Administração e Negócios',
    '653': 'Administração e Negócios', '654': 'Administração e Negócios', '655': 'Administração e Negócios',
    '656': 'Administração e Negócios', '658': 'Administração e Negócios', '659': 'Administração e Negócios',
    '657': 'Contabilidade',
    '660': 'Engenharia e Tecnologia', '661': 'Engenharia e Tecnologia', '662': 'Engenharia e Tecnologia',
    '663': 'Engenharia e Tecnologia', '664': 'Engenharia e Tecnologia', '665': 'Engenharia e Tecnologia',
    '666': 'Engenharia e Tecnologia', '667': 'Engenharia e Tecnologia', '668': 'Engenharia e Tecnologia',
    '669': 'Engenharia e Tecnologia',
    '681': 'Engenharia e Tecnologia', '682': 'Engenharia e Tecnologia',
    '683': 'Engenharia e Tecnologia', '680': None, '684': None, '685': None, '686': None, '687': None, '688': None, '689': None,
    '690': 'Engenharia e Tecnologia',
    '700': 'Artes Visuais', '701': 'Artes Visuais', '702': 'Artes Visuais', '703': 'Artes Visuais',
    '704': 'Artes Visuais', '705': 'Artes Visuais', '706': 'Artes Visuais', '707': 'Artes Visuais',
    '708': 'Artes Visuais', '709': 'Artes Visuais',
    '710': None, '711': None, '712': None, '713': None, '714': None, '715': None, '716': None, '717': None, '718': None, '719': None,
    '720': 'Artes Visuais', '721': 'Artes Visuais', '722': 'Artes Visuais', '723': 'Artes Visuais',
    '724': 'Artes Visuais', '725': 'Artes Visuais', '726': 'Artes Visuais', '727': 'Artes Visuais',
    '728': 'Artes Visuais', '729': 'Artes Visuais',
    '730': 'Artes Visuais', '731': 'Artes Visuais', '732': 'Artes Visuais', '733': 'Artes Visuais',
    '734': 'Artes Visuais', '735': 'Artes Visuais', '736': 'Artes Visuais', '737': 'Artes Visuais',
    '738': 'Artes Visuais', '739': 'Artes Visuais',
    '740': 'Artes Visuais', '741': 'Artes Visuais', '742': 'Artes Visuais', '743': 'Artes Visuais',
    '744': 'Artes Visuais', '745': 'Artes Visuais', '746': 'Artes Visuais', '747': 'Artes Visuais',
    '748': 'Artes Visuais', '749': 'Artes Visuais',
    '750': 'Artes Visuais', '751': 'Artes Visuais', '752': 'Artes Visuais', '753': 'Artes Visuais',
    '754': 'Artes Visuais', '755': 'Artes Visuais', '756': 'Artes Visuais', '757': 'Artes Visuais',
    '758': 'Artes Visuais', '759': 'Artes Visuais',
    '760': 'Artes Visuais', '761': 'Artes Visuais', '762': 'Artes Visuais', '763': 'Artes Visuais',
    '764': 'Artes Visuais', '765': 'Artes Visuais', '766': 'Artes Visuais', '767': 'Artes Visuais',
    '768': 'Artes Visuais', '769': 'Artes Visuais',
    '770': 'Artes Visuais', '771': 'Artes Visuais', '772': 'Artes Visuais', '773': 'Artes Visuais',
    '774': 'Artes Visuais', '775': 'Artes Visuais', '776': 'Artes Visuais', '777': 'Artes Visuais',
    '778': 'Artes Visuais', '779': 'Artes Visuais',
    '780': 'Música', '781': 'Música', '782': 'Música', '783': 'Música', '784': 'Música',
    '785': 'Música', '786': 'Música', '787': 'Música', '788': 'Música', '789': 'Música',
    '790': 'Esporte e Lazer', '791': 'Artes Visuais', '792': 'Teatro', '793': 'Esporte e Lazer',
    '794': 'Esporte e Lazer', '795': None, '796': 'Esporte e Lazer', '797': 'Esporte e Lazer',
    '798': 'Esporte e Lazer', '799': 'Esporte e Lazer',
    '800': None, '801': 'Crítica e Teoria Literária', '802': None, '803': None, '804': None, '805': None, '806': None,
    '807': 'Educação e Pedagogia', '808.1': 'Poesia', '808.2': 'Teatro', '808.3': None, '808.5': None,
    '808.6': None, '808.7': None, '808.8': None, '808': 'Crítica e Teoria Literária',
    '809': 'Crítica e Teoria Literária',
    '810': 'Literatura Estrangeira', '811': 'Poesia', '812': 'Teatro',
    '813': 'Literatura Estrangeira', '814': 'Literatura Estrangeira', '815': 'Literatura Estrangeira',
    '816': 'Literatura Estrangeira', '817': 'Literatura Estrangeira', '818': 'Literatura Estrangeira',
    '819': 'Literatura Estrangeira',
    '820': 'Literatura Estrangeira', '821': 'Poesia', '822': 'Teatro',
    '823': 'Literatura Estrangeira', '824': 'Literatura Estrangeira', '825': 'Literatura Estrangeira',
    '826': 'Literatura Estrangeira', '827': 'Literatura Estrangeira', '828': 'Literatura Estrangeira',
    '829': 'Literatura Estrangeira',
    '830': 'Literatura Estrangeira', '831': 'Poesia', '832': 'Teatro',
    '833': 'Literatura Estrangeira', '834': 'Literatura Estrangeira', '835': 'Literatura Estrangeira',
    '836': 'Literatura Estrangeira', '837': 'Literatura Estrangeira', '838': 'Literatura Estrangeira',
    '839': 'Literatura Estrangeira',
    '840': 'Literatura Estrangeira', '841': 'Poesia', '842': 'Teatro',
    '843': 'Literatura Estrangeira', '844': 'Literatura Estrangeira', '845': 'Literatura Estrangeira',
    '846': 'Literatura Estrangeira', '847': 'Literatura Estrangeira', '848': 'Literatura Estrangeira',
    '849': 'Literatura Estrangeira',
    '850': 'Literatura Estrangeira', '851': 'Poesia', '852': 'Teatro',
    '853': 'Literatura Estrangeira', '854': 'Literatura Estrangeira', '855': 'Literatura Estrangeira',
    '856': 'Literatura Estrangeira', '857': 'Literatura Estrangeira', '858': 'Literatura Estrangeira',
    '859': 'Literatura Estrangeira',
    '853': 'Literatura Estrangeira', '854': 'Literatura Estrangeira', '855': 'Literatura Estrangeira',
    '856': 'Literatura Estrangeira', '857': 'Literatura Estrangeira', '858': 'Literatura Estrangeira',
    '860': None, '861': 'Poesia', '862': 'Teatro',
    '863': 'Literatura Estrangeira', '864': 'Literatura Estrangeira', '865': 'Literatura Estrangeira',
    '866': 'Literatura Estrangeira', '867': 'Literatura Estrangeira', '868': 'Literatura Estrangeira',
    '869': 'Literatura de Língua Portuguesa', '869.1': 'Poesia', '869.2': 'Teatro',
    '870': 'Literatura Estrangeira', '880': 'Literatura Estrangeira', '881': 'Poesia',
    '890': 'Literatura Estrangeira',
    '894': 'Literatura Estrangeira', '895': 'Literatura Estrangeira', '896': 'Literatura Estrangeira',
    '001.42': 'Educação e Pedagogia', '001': None, '002': 'Biblioteconomia e Leitura',
    '800.1': 'Crítica e Teoria Literária',
    '900': 'História Geral',
    '910': 'Geografia e Viagens',
    '920': 'Biografias e Memórias', '929': 'Biografias e Memórias',
    '930': 'História Geral', '940': 'História Geral', '941': 'História Geral', '942': 'História Geral',
    '943': 'História Geral', '944': 'História Geral', '945': 'História Geral', '946': 'História Geral',
    '947': 'História Geral', '948': 'História Geral', '949': 'História Geral',
    '950': 'História Geral', '951': 'História Geral', '952': 'História Geral', '953': 'História Geral',
    '954': 'História Geral', '955': 'História Geral', '956': 'História Geral', '957': 'História Geral',
    '958': 'História Geral', '959': 'História Geral',
    '960': 'História Geral', '961': 'História Geral', '962': 'História Geral', '963': 'História Geral',
    '964': 'História Geral', '965': 'História Geral', '966': 'História Geral', '967': 'História Geral',
    '968': 'História Geral', '969': 'História Geral',
    '970': 'História Geral', '971': 'História Geral', '972': 'História Geral', '973': 'História Geral',
    '974': 'História Geral', '975': 'História Geral', '976': 'História Geral', '977': 'História Geral',
    '978': 'História Geral', '979': 'História Geral',
    '980': 'História Geral', '981': 'História do Brasil', '982': 'História Geral',
    '983': 'História Geral', '984': 'História Geral', '985': 'História Geral',
    '986': 'História Geral', '987': 'História Geral', '988': 'História Geral', '989': 'História Geral',
    '990': 'História Geral',
}

# Poesia/drama valem para qualquer literatura 8xx: ^8\d1 / ^8\d2
POETRY_RE = re.compile(r'^8\d1(\.|$)')
DRAMA_RE = re.compile(r'^8\d2(\.|$)')

# Keywords com override forte (vencem o Dewey sozinhas)
OVERRIDE_KW = {
    'concurso': 'Didáticos e Concursos', 'concursos': 'Didáticos e Concursos',
    'concurseiro': 'Didáticos e Concursos', 'vestibular': 'Didáticos e Concursos',
    'enem': 'Didáticos e Concursos',
    'biblia': 'Religião e Espiritualidade', 'biblias': 'Religião e Espiritualidade',
    'gibi': 'Quadrinhos e Gibis', 'gibis': 'Quadrinhos e Gibis',
    'quadrinho': 'Quadrinhos e Gibis', 'quadrinhos': 'Quadrinhos e Gibis',
    'manga': 'Quadrinhos e Gibis', 'mangas': 'Quadrinhos e Gibis',
}

# (categoria, keywords) — match por palavra inteira em keyword simples
KEYWORDS = [
    ('Didáticos e Concursos', ['concurso', 'concursos', 'concurseiro', 'vestibular', 'enem', 'oab', 'exame de ordem', 'prova', 'provas', 'questoes', 'didatico', 'apostila']),
    ('Religião e Espiritualidade', ['biblia', 'evangelho', 'oracao', 'pastor', 'igreja', 'catecismo', 'espirita', 'kardec', 'umbanda', 'candomble', 'teologia', 'milagre']),
    ('Direito', ['constituicao', 'constitucional', 'codigo civil', 'codigo penal', 'codigo de processo', 'tribunal', 'sumula', 'licitacao', 'estatuto', 'clt', 'direito penal', 'direito civil']),
    ('Culinária e Economia Doméstica', ['receita', 'cozinha', 'culinaria', 'gastronomia', 'forno e fogao']),
    ('Medicina e Saúde', ['gravidez', 'bebe', 'pediatria', 'nutricao', 'medicina', 'enfermagem', 'anatomia', 'fisioterapia', 'odontologia', 'saude publica']),
    ('Autoajuda e Desenvolvimento Pessoal', ['autoajuda', 'autoestima', 'habito', 'mindset', 'inteligencia emocional', 'proposito de vida']),
    ('Administração e Negócios', ['gestao empresarial', 'lideranca', 'marketing', 'empreendedor', 'negocios', 'recursos humanos', 'administracao de empresas']),
    ('Quadrinhos e Gibis', ['gibi', 'quadrinho', 'manga', 'turma da monica', 'marvel']),
    ('Literatura Infantil', ['colorir', 'conto de fadas', 'chapeuzinho', 'para criancas', 'pop-up']),
    ('Biografias e Memórias', ['biografia', 'autobiografia', 'memorias', 'minha historia']),
    ('História do Brasil', ['historia do brasil', 'imperio do brasil', 'republica velha', 'ditadura militar', 'escravidao', 'dom pedro', 'getulio vargas', 'brasil colonia']),
    ('Geografia e Viagens', ['atlas geografico', 'guia de viagem', 'turismo', 'roteiro de viagem']),
    ('Esporte e Lazer', ['futebol', 'copa do mundo', 'olimpiada', 'xadrez', 'regras do jogo']),
    ('Música', ['violao', 'piano', 'partitura', 'teoria musical', 'canto coral']),
    ('Literatura Juvenil', ['harry potter', 'percy jackson', 'jogos vorazes', 'crepusculo', 'diario de um banana', 'juvenil']),
    ('Poesia', ['livro de poemas', 'coletanea de poemas']),
    ('Economia e Finanças', ['financas pessoais', 'investimento', 'bolsa de valores', 'educacao financeira']),
    ('Contabilidade', ['contabilidade', 'auditoria contabil', 'ciencias contabeis']),
    ('Psicologia', ['psicologia', 'psicanalise', 'terapia cognitiva']),
    ('Filosofia', ['nietzsche', 'platao', 'aristoteles', 'seneca', 'estoicismo', 'kant', 'filosofia do direito']),
    ('Informática e Computação', ['programacao', 'programar', 'programador', 'algoritmo', 'software', 'hardware', 'banco de dados', 'ciencia de dados', 'rede de computadores', 'sistema operacional', 'linguagem php', 'linguagem python', 'php', 'python', 'linux', 'sql', 'mysql', 'kali', 'excel', 'windows', 'android', 'docker', 'scrum', 'computador', 'computadores', 'informatica']),
    ('Educação e Pedagogia', ['educacao infantil', 'ensino fundamental', 'ensino medio', 'alfabetizacao', 'tcc', 'trabalho de conclusao', 'metodologia cientifica', 'iniciacao cientifica', 'didatica']),
    ('Matemática', ['matematica']),
    ('Ciências Naturais', ['biologia', 'fauna', 'flora', 'animais', 'meteorologia', 'fisica', 'quimica']),
    ('Linguagem e Linguística', ['gramatica', 'lingua inglesa', 'lingua portuguesa', 'aula de ingles']),
    ('Meio Ambiente e Ecologia', ['meio ambiente', 'ecologia', 'sustentavel', 'sustentabilidade', 'desertificacao', 'impacto ambiental']),
    ('Ciências Naturais', ['biologia', 'fauna', 'flora', 'animais', 'meteorologia', 'anuario mineral']),
]

# Autores-âncora: sobrenome -> categoria
AUTHORS = {
    'machado de assis': 'Literatura de Língua Portuguesa', 'clarice lispector': 'Literatura de Língua Portuguesa',
    'guimaraes rosa': 'Literatura de Língua Portuguesa', 'jorge amado': 'Literatura de Língua Portuguesa',
    'paulo coelho': 'Literatura de Língua Portuguesa', 'monteiro lobato': 'Literatura Infantil',
    'mauricio de sousa': 'Quadrinhos e Gibis', 'ruth rocha': 'Literatura Infantil',
    'cecilia meireles': 'Poesia', 'carlos drummond de andrade': 'Poesia', 'vinicius de moraes': 'Poesia',
    'stephen king': 'Literatura Estrangeira', 'agatha christie': 'Literatura Estrangeira',
    'j.k. rowling': 'Literatura Juvenil', 'j r r tolkien': 'Literatura Estrangeira',
    'george orwell': 'Literatura Estrangeira', 'shakespeare': 'Teatro',
}

OL_MAP = [
    ('Literatura Infantil', ['picture books', 'juvenile literature']),
    ('Informática e Computação', ['programming', 'computer', 'software', 'python', 'java']),
    ('Direito', ['law']),
    ('Administração e Negócios', ['business', 'management']),
    ('Medicina e Saúde', ['medicine', 'health']),
    ('História Geral', ['history']),
    ('História do Brasil', ['brazil']),
    ('Religião e Espiritualidade', ['religion', 'bible', 'christian']),
    ('Filosofia', ['philosophy']),
    ('Psicologia', ['psychology']),
    ('Educação e Pedagogia', ['education']),
    ('Matemática', ['mathematics']),
    ('Ciências Naturais', ['science']),
    ('Artes Visuais', ['art']),
    ('Música', ['music']),
    ('Esporte e Lazer', ['sports']),
    ('Culinária e Economia Doméstica', ['cooking']),
    ('Poesia', ['poetry']),
    ('Biografias e Memórias', ['biography']),
    ('Quadrinhos e Gibis', ['comics']),
    ('Economia e Finanças', ['finance', 'economics']),
    ('Comunicação e Jornalismo', ['journalism', 'journalist', 'news', 'reporting']),
    ('Ciências Sociais', ['folklore', 'mythology', 'legends', 'sociology']),
    ('Literatura Estrangeira', ['spanish fiction', 'spanish literature', 'french fiction', 'german fiction', 'italian fiction', 'russian fiction', 'american fiction', 'english fiction']),
    ('Literatura de Língua Portuguesa', ['brazilian', 'portuguese']),
    ('Literatura Juvenil', ['young adult']),
]

# Marcadores juvenis/infantis multilíngues (prioridade sobre o mapa genérico)
OL_YOUNG = ['juvenile fiction', 'young adult', 'teenagers', 'juvenil', 'jeugd', 'jeunesse', 'young adult fiction']
OL_PICTURE = ['picture books']

REVIEW_BUCKETS = ('028', '808.3', '808.5', '808.6', '808.7', '808.8', '860', '800', '802', '310')


def fold(s):
    s = (s or '').lower()
    return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')


HUNDRED = {'0': None, '1': 'Filosofia', '2': 'Religião e Espiritualidade',
           '3': 'Ciências Sociais', '4': 'Linguagem e Linguística', '5': 'Ciências Naturais',
           '6': None, '7': None, '8': None, '9': 'História Geral'}


def dewey_cat(cdd):
    parts = (cdd or '').strip().replace(',', '.').split()
    if not parts:
        return None, 'sem dewey'
    c = re.sub(r'^[^0-9]+', '', parts[0])
    if not c or not c[0].isdigit():
        return None, 'sem dewey'
    if POETRY_RE.match(c):
        return 'Poesia', 'regra 8x1'
    if DRAMA_RE.match(c):
        return 'Teatro', 'regra 8x2'
    for i in range(len(c), 0, -1):
        if c[:i] in DEWEY:
            v = DEWEY[c[:i]]
            return (v, f'dewey {c[:i]}') if v else (None, f'dewey {c[:i]} ambiguo')
    h = HUNDRED.get(c[0])
    return (h, f'dewey centena {c[0]}00') if h else (None, 'sem dewey')


def kw_match(blob, kw):
    if ' ' in kw:
        return kw in blob
    return re.search(r'\b' + re.escape(kw) + r'\b', blob) is not None


def ol_match(subs, kw):
    return any(re.search(r'\b' + re.escape(kw) + r'\b', s) for s in subs)


def load_cache():
    if CACHE.exists():
        return json.loads(CACHE.read_text(encoding='utf-8'))
    return {}


def ol_subjects(isbn, cache):
    if not isbn or SKIP_ENRICH:
        return []
    if isbn in cache:
        return cache[isbn]
    try:
        req = urllib.request.Request(
            f'https://openlibrary.org/isbn/{isbn}.json',
            headers={'User-Agent': 'BibliotecaPublica/1.0 (catalog-review)'},
        )
        with urllib.request.urlopen(req, timeout=15) as r:
            ed = json.loads(r.read().decode('utf-8'))
        subs = [s.lower() for s in ed.get('subjects', []) if isinstance(s, str)]
        if not subs and ed.get('works'):
            wk = ed['works'][0]['key']
            req2 = urllib.request.Request(f'https://openlibrary.org{wk}.json',
                                          headers={'User-Agent': 'BibliotecaPublica/1.0 (catalog-review)'})
            with urllib.request.urlopen(req2, timeout=15) as r2:
                subs = [s.lower() for s in json.loads(r2.read().decode('utf-8')).get('subjects', []) if isinstance(s, str)]
        cache[isbn] = subs
        time.sleep(0.35)
        return subs
    except Exception:
        cache[isbn] = []
        return []


def main():
    db = sqlite3.connect(str(DB))
    db.row_factory = sqlite3.Row
    cur = db.cursor()
    q = ('SELECT b.id, b.title, b.subtitle, b.description, b.isbn10, b.isbn13, b.cdd, b.publisher, '
         'GROUP_CONCAT(a.name, char(10)) AS authors FROM Book b LEFT JOIN BookAuthor ba ON ba.bookId = b.id '
         'LEFT JOIN Author a ON a.id = ba.authorId WHERE b.isArchived = 0 GROUP BY b.id ORDER BY b.id')
    rows = cur.execute(q).fetchall()
    if LIMIT:
        rows = rows[:LIMIT]
    cache = load_cache()
    out = []
    stats = {'AUTO': 0, 'REVIEW': 0, 'INSUFFICIENT': 0}
    for n, r in enumerate(rows, 1):
        blob = fold(' '.join([r['title'] or '', r['subtitle'] or '', r['description'] or '', r['authors'] or '', r['publisher'] or '']))
        cdd = (r['cdd'] or '').strip()
        dcat, dreason = dewey_cat(cdd)
        kw_hits = [(cat, kw) for cat, kws in KEYWORDS for kw in kws if kw and kw_match(blob, kw)]
        kw_cats = sorted({c for c, _ in kw_hits})
        overrides = sorted({OVERRIDE_KW[kw] for _, kw in kw_hits if kw in OVERRIDE_KW})
        auth_hit = None
        for a in (r['authors'] or '').split('\n'):
            af = fold(a)
            for k, v in AUTHORS.items():
                if k in af:
                    auth_hit = v
                    break
            if auth_hit:
                break
        isbn = r['isbn13'] or r['isbn10']
        if not isbn and cdd and ('-' in cdd or not cdd[0].isdigit()):
            digits = re.sub(r'\D', '', cdd)
            if len(digits) in (10, 13):
                isbn = digits
                motivos.append(f'isbn extraido do cdd: {isbn}')
        raw_cdd_upper = cdd.upper()
        subs = ol_subjects(isbn, cache) if (not cdd or cdd[:3] in ('028', '808') or cdd[:2] in ('86',) or dreason == 'sem dewey') else []
        ol_cats = sorted({c for c, kws in OL_MAP for kw in kws if ol_match(subs, kw)})
        if any(ol_match(subs, kw) for kw in OL_YOUNG):
            ol_cats = ['Literatura Juvenil']
            motivos.append('ol=juvenil')
        elif any(ol_match(subs, kw) for kw in OL_PICTURE):
            ol_cats = ['Literatura Infantil']
            motivos.append('ol=infantil')
        cur_cats = [x[0] for x in cur.execute(
            'SELECT c.name FROM Category c JOIN BookCategory bc ON bc.categoryId = c.id WHERE bc.bookId = ?', (r['id'],))]

        motivos = [f'cdd={cdd or "-"} ({dreason})']
        if kw_hits:
            motivos.append('keywords=' + ','.join(sorted({k for _, k in kw_hits})))
        if auth_hit:
            motivos.append(f'autor={auth_hit}')
        if subs:
            motivos.append('ol=' + ','.join(subs[:8]))

        rec, status = None, 'INSUFFICIENT'
        bucket_review = cdd[:5] in REVIEW_BUCKETS or cdd[:3] in ('028', '808') or (cdd[:2] == '86' and not cdd.startswith('869'))
        candidates = [c for c in [dcat, auth_hit] + kw_cats + ol_cats if c]
        if len(overrides) == 1:
            rec, status = overrides[0], 'AUTO'
            motivos.append('override forte: ' + ','.join(sorted({k for _, k in kw_hits if k in OVERRIDE_KW})))
        elif len(overrides) > 1:
            rec, status = None, 'REVIEW'
            motivos.append('overrides conflitantes: ' + ','.join(overrides))
        elif not cdd and not candidates:
            rec, status = None, 'INSUFFICIENT'
            motivos.append('sem sinais suficientes')
        elif bucket_review and len(set(candidates)) != 1:
            # bucket ambiguo sem consenso
            if auth_hit and (not kw_cats or auth_hit in kw_cats):
                rec, status = auth_hit, 'REVIEW'
            elif len(set(kw_cats)) == 1 and (not ol_cats or kw_cats[0] in ol_cats):
                rec, status = kw_cats[0], 'REVIEW'
            elif len(set(ol_cats)) == 1:
                rec, status = ol_cats[0], 'REVIEW'
            elif cdd.startswith('028'):
                rec, status = 'Literatura Infantil', 'REVIEW'
                motivos.append('default bucket 028: presumido infantil, validar')
            elif cdd.startswith('808.899282'):
                rec, status = 'Literatura de Língua Portuguesa', 'REVIEW'
                motivos.append('default ficcao BR presumida, validar')
            elif raw_cdd_upper.startswith('R'):
                rec, status = 'Didáticos e Concursos', 'REVIEW'
                motivos.append('default serie didatica R*, validar')
            else:
                rec, status = (candidates[0] if candidates else None), 'REVIEW'
                motivos.append('bucket ambiguo sem consenso')
        elif dcat and kw_cats and dcat not in kw_cats:
            rec, status = dcat, 'REVIEW'
            motivos.append(f'conflito dewey({dcat}) x keywords({",".join(kw_cats)})')
        elif dcat and ol_cats and dcat not in ol_cats and 'fiction' not in ' '.join(subs):
            rec, status = dcat, 'REVIEW'
            motivos.append(f'conflito dewey({dcat}) x openlibrary({",".join(ol_cats)})')
        elif dcat:
            rec, status = dcat, 'AUTO'
        elif len(set(candidates)) == 1:
            rec, status = candidates[0], 'AUTO' if (auth_hit or ol_cats) else 'REVIEW'
        elif candidates:
            rec, status = candidates[0], 'REVIEW'
            motivos.append('candidatos divergentes')
        if rec and rec not in TAX:
            rec, status = None, 'REVIEW'
            motivos.append('recomendacao fora da taxonomia')
        stats[status] += 1
        out.append({
            'id': r['id'], 'titulo': r['title'], 'isbn': isbn,
            'categoriaAtual': cur_cats, 'categoriaRecomendada': rec,
            'status': status, 'motivos': motivos,
            'cdd': cdd or None, 'olSubjects': subs[:8] if subs else [],
        })
        if n % 500 == 0:
            print(f'... {n}/{len(rows)}', flush=True)
    CACHE.write_text(json.dumps(cache, ensure_ascii=False), encoding='utf-8')
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')
    print('STATS:', stats, flush=True)
    print('OUT:', str(OUT), flush=True)


main()

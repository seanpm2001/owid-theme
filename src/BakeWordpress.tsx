import * as request from 'request-promise'
import * as fs from 'fs-extra'
import * as path from 'path'
import * as glob from 'glob'
import {without, chunk} from 'lodash'
import * as shell from 'shelljs'
import * as _ from 'lodash'
import * as cheerio from 'cheerio'

import * as wpdb from './wpdb'
import { formatPost, FormattedPost } from './formatting'
import { ArticlePage } from './views/ArticlePage'
import { BlogPostPage } from './views/BlogPostPage'
import * as settings from './settings'
const { BAKED_DIR, BAKED_URL, WORDPRESS_URL, WORDPRESS_DIR, BLOG_POSTS_PER_PAGE } = settings
import { renderFrontPage, renderBlogByPageNum } from './renderPage'
import { bakeGrapherUrls, getGrapherExportsByUrl, GrapherExports } from './grapherUtil'

import * as React from 'react'
import * as ReactDOMServer from 'react-dom/server'

// Static site generator using Wordpress

export interface WPBakerProps {
    forceUpdate?: boolean
}

export default class WordpressBaker {
    props: WPBakerProps
    grapherExports: GrapherExports
    stagedFiles: string[] = []
    constructor(props: WPBakerProps) {
        this.props = props;
        (settings as any).IS_BAKING = true
    }

    async bakeRedirects() {
        const {props} = this
        const redirects = [
            "/feed /atom.xml 302",
            "/entries /#entries 302",
            "/chart-builder/* /grapher/:splat 301",
            "/grapher/public/* /grapher/:splat 301",
            "/grapher/view/* /grapher/:splat 301",
            "/wp-admin/* https://owid.cloud/wp-admin/:splat 302",
            "/wp-login.php https://owid.cloud/wp-login.php 302",
            "/grapher/admin/* https://owid.cloud/grapher/admin/:splat 302",
            "/roser/* https://www.maxroser.com/roser/:splat 302",
            "/wp-content/uploads/nvd3/* https://www.maxroser.com/owidUploads/nvd3/:splat 302",
            "/wp-content/uploads/datamaps/* https://www.maxroser.com/owidUploads/datamaps/:splat 302",
            "/grapher/* https://owid-grapher.netlify.com/grapher/:splat 200",
            "/mispy/sdgs/* https://owid-sdgs.netlify.com/:splat 302",
            "/slides/Max_PPT_presentations/* https://www.maxroser.com/slides/Max_PPT_presentations/:splat 302",
            "/slides/Max_Interactive_Presentations/* https://www.maxroser.com/slides/Max_Interactive_Presentations/:splat 302"
        ]
    
        const rows = await wpdb.query(`SELECT url, action_data, action_code FROM wp_redirection_items`)
        redirects.push(...rows.map(row => `${row.url} ${row.action_data} ${row.action_code}`))

        await this.stageWrite(path.join(BAKED_DIR, `_redirects`), redirects.join("\n"))
    }

    async bakeEmbeds() {
        // Find all grapher urls used as embeds in all posts on the site
        const rows = await wpdb.query(`SELECT post_content FROM wp_posts WHERE (post_type='page' OR post_type='post') AND post_status='publish'`)
        let grapherUrls = []
        for (const row of rows) {
            const $ = cheerio.load(row.post_content)
            grapherUrls.push(...$("iframe").toArray().filter(el => (el.attribs['src']||'').match(/\/grapher\//)).map(el => el.attribs['src']))
        }
        grapherUrls = _.uniq(grapherUrls)

        // Now bake (the grapher handles versioning as only it knows the current version of charts)
        await bakeGrapherUrls(grapherUrls)

        this.grapherExports = await getGrapherExportsByUrl()
    }

    // Bake an individual post/page
    async bakePost(post: wpdb.FullPost) {
        const entries = await wpdb.getEntriesByCategory()
        const formatted = await formatPost(post, this.grapherExports)
        const html = ReactDOMServer.renderToStaticMarkup(
            post.type == 'post' ? <BlogPostPage entries={entries} post={formatted}/> : <ArticlePage entries={entries} post={formatted}/>
        )

        const outPath = path.join(BAKED_DIR, `${post.slug}.html`)
        await fs.mkdirp(path.dirname(outPath))        
        await this.stageWrite(outPath, html)
    }

    // Bake all Wordpress posts, both blog posts and entry pages
    async bakePosts() {
        const {forceUpdate} = this.props
        const postsQuery = wpdb.query(`SELECT * FROM wp_posts WHERE (post_type='page' OR post_type='post') AND post_status='publish'`)
    
        const rows = await postsQuery
    
        let bakingPosts = []
        let postSlugs = []
        for (const row of rows) {
            if (row.post_name === 'blog') // Handled separately
                continue

            const post = await wpdb.getFullPost(row)
            postSlugs.push(post.slug)
            bakingPosts.push(post)
        }

        await Promise.all(bakingPosts.map(post => this.bakePost(post)))

        // Delete any previously rendered posts that aren't in the database
        const existingSlugs = glob.sync(`${BAKED_DIR}/**/*.html`).map(path => path.replace(`${BAKED_DIR}/`, '').replace(".html", ""))
            .filter(path => !path.startsWith('wp-') && !path.startsWith('slides') && !path.startsWith('blog') && path !== "index" && path !== "identifyadmin" && path !== "404")
        const toRemove = without(existingSlugs, ...postSlugs)
        for (const slug of toRemove) {
            const outPath = `${BAKED_DIR}/${slug}.html`
            await fs.unlink(outPath)
            this.stage(outPath, `DELETING ${outPath}`)
        }
    }

    async bakeFrontPage() {
        return this.stageWrite(`${BAKED_DIR}/index.html`, await renderFrontPage())
    }

    async bakeBlog() {
        const allPosts = await wpdb.getBlogIndex()
        const numPages = Math.ceil(allPosts.length/BLOG_POSTS_PER_PAGE)

        for (let i = 1; i <= numPages; i++) {
            const slug = i === 1 ? 'blog' : `blog/page/${i}`
            const html = await renderBlogByPageNum(i)
            await this.stageWrite(`${BAKED_DIR}/${slug}.html`, html)
        }
    }

    async bakeRSS() {
        const postRows = await wpdb.query(`SELECT * FROM wp_posts WHERE post_type='post' AND post_status='publish' ORDER BY post_date DESC LIMIT 10`)

        const posts: FormattedPost[] = []
        for (const row of postRows) {
            const fullPost = await wpdb.getFullPost(row)
            posts.push(await formatPost(fullPost))
        }

        const feed = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
    <title>Our World in Data</title>
    <subtitle>Living conditions around the world are changing rapidly. Explore how and why.</subtitle>
    <id>${BAKED_URL}/</id>
    <link type="text/html" rel="alternate" href="${BAKED_URL}"/>
    <link type="application/atom+xml" rel="self" href="${BAKED_URL}/atom.xml"/>
    <updated>${posts[0].date.toISOString()}</updated>
    ${posts.map(post => `<entry>
        <title>${post.title}</title>
        <id>${BAKED_URL}/${post.slug}</id>
        <link rel="alternate" href="${BAKED_URL}/${post.slug}"/>
        <published>${post.date.toISOString()}</published>
        <updated>${post.modifiedDate.toISOString()}</updated>
        ${post.authors.map(author => `<author><name>${author}</name></author>`).join("")}
        <summary>${post.excerpt}</summary>
    </entry>`).join("\n")}
</feed>
`
        await this.stageWrite(`${BAKED_DIR}/atom.xml`, feed)
    }

    async bakeAssets() {
        shell.exec(`rsync -havz --delete ${WORDPRESS_DIR}/wp-content/themes/owid-theme/identifyadmin.html ${BAKED_DIR}/`)
        shell.exec(`rsync -havz --delete ${WORDPRESS_DIR}/wp-content ${BAKED_DIR}/`)
        shell.exec(`rsync -havz --delete ${WORDPRESS_DIR}/wp-includes ${BAKED_DIR}/`)
        shell.exec(`rsync -havz --delete ${WORDPRESS_DIR}/favicon* ${BAKED_DIR}/`)
        shell.exec(`rsync -havz --delete ${WORDPRESS_DIR}/slides/ ${BAKED_DIR}/slides`)
        shell.exec(`rsync -havz --delete ${WORDPRESS_DIR}/wp-content/themes/owid-theme/404.html ${BAKED_DIR}/`)
    }

    async bakeAll() {
        await this.bakeRedirects()
        await this.bakeBlog()
        await this.bakeRSS()
        await this.bakeAssets()
        await this.bakeEmbeds()
        await this.bakeFrontPage()
        await this.bakePosts()
    }

    async stageWrite(outPath: string, content: string) {
        await fs.mkdirp(path.dirname(outPath))
        await fs.writeFile(outPath, content)
        this.stage(outPath)
    }

    stage(outPath: string, msg?: string) {
        console.log(msg||outPath)
        this.stagedFiles.push(outPath)
    }

    exec(cmd: string) {
        console.log(cmd)
        shell.exec(cmd)
    }

    async deploy(commitMsg: string, authorEmail?: string, authorName?: string) {
        for (const files of chunk(this.stagedFiles, 100)) {
            this.exec(`cd ${BAKED_DIR} && git add -A ${files.join(" ")}`)
        }
        if (authorEmail && authorName && commitMsg) {
            this.exec(`cd ${BAKED_DIR} && git add -A . && git commit --author='${authorName} <${authorEmail}>' -a -m '${commitMsg}' && git push origin master`)
        } else {
            this.exec(`cd ${BAKED_DIR} && git add -A . && git commit -a -m '${commitMsg}' && git push origin master`)
        }
    }

    end() {
        wpdb.end()
    }
}